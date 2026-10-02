import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import type { AllowEmailDto, UpdateAllowedEmailDto } from './dto/allow-email.dto';

export interface AllowedEmail {
  id: string;
  email: string;
  name: string;
  role: string;
  branch: { id: string; code: string; name: string } | null;
  status: 'ACTIVE' | 'DISABLED';
  /** True once the login exists — set by the `users_link_login` trigger on add. */
  canSignIn: boolean;
  createdAt: string;
}

/**
 * The "Allowed emails" list — `/admin/users` · `config.manage`.
 *
 * Sign-in is by emailed one-time code, and only an email on this list can
 * get a code: adding a row here is what creates the Supabase login (the
 * `users_link_login` trigger, migration 20261002000000). The role chosen here
 * is the role the person signs in with — `SupabaseJwtGuard` reads it from
 * this row on every request, never from the token.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: InternalDb,
    private readonly auditService: AuditService,
  ) {}

  async list(): Promise<AllowedEmail[]> {
    const rows = await this.query(this.db).orderBy('users.created_at', 'desc').execute();
    return rows.map(toAllowed);
  }

  async allow(dto: AllowEmailDto, actor: AuthenticatedUser): Promise<AllowedEmail> {
    const email = dto.email.trim().toLowerCase();
    if (email.endsWith('.internal')) {
      throw new DomainException(400, 'EMAIL_RESERVED', 'That address is reserved for the system.');
    }
    return this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('users')
        .select(['id', 'status'])
        .where('email', '=', email)
        .executeTakeFirst();
      if (existing) {
        throw new DomainException(
          409,
          'EMAIL_ALREADY_ALLOWED',
          existing.status === 'DISABLED'
            ? 'This email is already on the list but switched off. Switch it back on instead.'
            : 'This email is already allowed to sign in.',
        );
      }
      const roleId = await this.roleId(trx, dto.role);
      await this.assertBranch(trx, dto.branchId);
      const inserted = await trx
        .insertInto('users')
        .values({
          email,
          name: dto.name?.trim() || email.split('@')[0],
          role_id: roleId,
          branch_id: dto.branchId ?? null,
          status: 'ACTIVE',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.auditService.record(trx, actor, {
        action: 'USER_ALLOWED',
        entityType: 'users',
        entityId: inserted.id,
        after: { email, role: dto.role, branchId: dto.branchId ?? null },
      });
      return this.one(trx, inserted.id);
    });
  }

  async update(id: string, dto: UpdateAllowedEmailDto, actor: AuthenticatedUser): Promise<AllowedEmail> {
    // The one mistake nobody can undo from inside the console: an
    // administrator locking themselves out.
    if (id === actor.userId && (dto.status === 'DISABLED' || (dto.role && dto.role !== 'ADMIN'))) {
      throw new DomainException(
        409,
        'SELF_LOCKOUT',
        'You cannot switch off or change your own access. Ask another administrator.',
      );
    }
    return this.db.transaction().execute(async (trx) => {
      const before = await this.one(trx, id);
      const patch: { role_id?: string; name?: string; branch_id?: string | null; status?: string } = {};
      if (dto.role) patch.role_id = await this.roleId(trx, dto.role);
      if (dto.name !== undefined) patch.name = dto.name.trim() || before.name;
      if (dto.branchId !== undefined) {
        await this.assertBranch(trx, dto.branchId ?? undefined);
        patch.branch_id = dto.branchId;
      }
      if (dto.status) patch.status = dto.status;
      if (Object.keys(patch).length === 0) return before;

      await trx
        .updateTable('users')
        .set({ ...patch, updated_at: new Date().toISOString() })
        .where('id', '=', id)
        .execute();
      const after = await this.one(trx, id);
      await this.auditService.record(trx, actor, {
        action: 'USER_ACCESS_CHANGED',
        entityType: 'users',
        entityId: id,
        before: { role: before.role, branchId: before.branch?.id ?? null, status: before.status, name: before.name },
        after: { role: after.role, branchId: after.branch?.id ?? null, status: after.status, name: after.name },
      });
      return after;
    });
  }

  private query(db: DbExecutor) {
    return db
      .selectFrom('users')
      .innerJoin('roles', 'roles.id', 'users.role_id')
      .leftJoin('branches', 'branches.id', 'users.branch_id')
      .select([
        'users.id as id',
        'users.email as email',
        'users.name as name',
        'users.status as status',
        'users.auth_user_id as authUserId',
        'users.created_at as createdAt',
        'roles.code as role',
        'branches.id as branchId',
        'branches.code as branchCode',
        'branches.name as branchName',
      ])
      // System principals (Portal System) are not people and cannot sign in.
      .where('users.email', 'not like', '%.internal');
  }

  private async one(db: DbExecutor, id: string): Promise<AllowedEmail> {
    const row = await this.query(db).where('users.id', '=', id).executeTakeFirst();
    if (!row) throw new DomainException(404, 'NOT_FOUND', 'No such person on the list.');
    return toAllowed(row);
  }

  private async roleId(db: DbExecutor, code: string): Promise<string> {
    const row = await db.selectFrom('roles').select('id').where('code', '=', code).executeTakeFirst();
    if (!row) throw new DomainException(404, 'NOT_FOUND', `Unknown role: ${code}`);
    return row.id;
  }

  private async assertBranch(db: DbExecutor, branchId: string | undefined): Promise<void> {
    if (!branchId) return;
    const row = await db.selectFrom('branches').select('id').where('id', '=', branchId).executeTakeFirst();
    if (!row) throw new DomainException(404, 'NOT_FOUND', 'That branch does not exist.');
  }
}

function toAllowed(r: {
  id: string;
  email: string;
  name: string;
  status: string;
  authUserId: string | null;
  createdAt: string;
  role: string;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
}): AllowedEmail {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    branch: r.branchId ? { id: r.branchId, code: r.branchCode ?? '', name: r.branchName ?? '' } : null,
    status: r.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    canSignIn: Boolean(r.authUserId),
    createdAt: String(r.createdAt),
  };
}
