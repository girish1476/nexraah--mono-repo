import { describe, it, expect } from 'vitest';
import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { CreateClientDto } from '../../modules/clients/dto/create-client.dto';
import { CreateVendorDto } from '../../modules/vendors/dto/create-vendor.dto';
import { PatchLrDto } from '../../modules/trips/dto/patch-lr.dto';
import { CreateIndentDto } from '../../modules/indents/dto/create-indent.dto';
import { SubmitClientDocumentDto } from '../../modules/clients/dto/submit-client-document.dto';

/**
 * The validation boundary — the layer that decides whether a request is
 * allowed to reach a service at all.
 *
 * These are internal-api's first tests. Until now the app had no test runner,
 * which is why every validation bug found here was found by somebody reading
 * the code rather than by anything failing: the portal's fixture adapter does
 * not validate, so a DTO that silently drops a field looks perfectly healthy
 * from the front end.
 *
 * The pipe below is constructed with **the same options as `main.ts`**
 * (`whitelist: true, transform: true`) rather than defaults, so what is
 * exercised is the behaviour requests actually meet. Where that configuration
 * is itself the problem, the test says so and pins the current behaviour
 * rather than the behaviour we would prefer — see "silently strips" below.
 *
 * No database is involved, and none is needed: nothing here reaches a service.
 */

const pipe = new ValidationPipe({ whitelist: true, transform: true });

const meta = (metatype: unknown): ArgumentMetadata => ({
  type: 'body',
  metatype: metatype as ArgumentMetadata['metatype'],
  data: '',
});

/** Runs a payload through the pipe. Returns the transformed value, or throws. */
const run = <T>(dto: unknown, payload: unknown): Promise<T> =>
  pipe.transform(payload, meta(dto)) as Promise<T>;

/** Asserts the pipe rejected, and returns the field names it complained about. */
async function rejectedFields(dto: unknown, payload: unknown): Promise<string[]> {
  try {
    await run(dto, payload);
    throw new Error('expected validation to reject, but it passed');
  } catch (e: unknown) {
    const response = (e as { response?: { message?: string[] } }).response;
    if (!response?.message) throw e;
    return response.message;
  }
}

const validClient = {
  name: 'Berger Paints',
  billingCity: 'Kolkata',
  engagement: 'CONTRACT' as const,
};

const validVendor = {
  legalName: 'Rathod Roadlines',
  partyType: 'VENDOR' as const,
  baseCity: 'Nashik',
  phone: '9822014471',
};

describe('clients — formats the portal enforced and the server did not', () => {
  it('accepts a minimal valid client', async () => {
    await expect(run(CreateClientDto, { ...validClient })).resolves.toBeTruthy();
  });

  it('rejects a malformed email', async () => {
    // Was `@IsString()`: "not-an-email" sailed through to the database.
    const fields = await rejectedFields(CreateClientDto, { ...validClient, email: 'not-an-email' });
    expect(fields.join(' ')).toMatch(/email/i);
  });

  it('rejects a phone that is not a ten-digit Indian mobile', async () => {
    for (const phone of ['12345', '5551234567', '98220144710', 'abcdefghij']) {
      const fields = await rejectedFields(CreateClientDto, { ...validClient, phone });
      expect(fields.join(' '), `${phone} should be refused`).toMatch(/ten-digit/i);
    }
  });

  it('accepts a real Indian mobile', async () => {
    await expect(run(CreateClientDto, { ...validClient, phone: '9822014471' })).resolves.toBeTruthy();
  });

  it('rejects a GSTIN of the wrong shape', async () => {
    for (const gstin of ['ABC', '19AAACB2545C1Z', 'not-a-gstin-xx']) {
      const fields = await rejectedFields(CreateClientDto, { ...validClient, gstin });
      expect(fields.join(' '), `${gstin} should be refused`).toMatch(/GSTIN/i);
    }
  });

  it('accepts a well-formed GSTIN', async () => {
    await expect(run(CreateClientDto, { ...validClient, gstin: '19AAACB2545C1Z9' })).resolves.toBeTruthy();
  });

  it('rejects a date that is not a date', async () => {
    const fields = await rejectedFields(CreateClientDto, { ...validClient, validFrom: 'sometime in March' });
    expect(fields.join(' ')).toMatch(/validFrom/);
  });

  it('rejects an attachment id that is not a uuid', async () => {
    const fields = await rejectedFields(CreateClientDto, { ...validClient, agreementAttachmentId: 'att-123' });
    expect(fields.join(' ')).toMatch(/agreementAttachmentId/);
  });
});

describe('vendors', () => {
  it('accepts a minimal valid vendor', async () => {
    await expect(run(CreateVendorDto, { ...validVendor })).resolves.toBeTruthy();
  });

  it('requires a real mobile number — phone is mandatory here', async () => {
    const fields = await rejectedFields(CreateVendorDto, { ...validVendor, phone: '123' });
    expect(fields.join(' ')).toMatch(/ten-digit/i);
  });

  it('rejects a branch id that is not a uuid', async () => {
    const fields = await rejectedFields(CreateVendorDto, { ...validVendor, branchId: 'br-nsk' });
    expect(fields.join(' ')).toMatch(/branchId/);
  });

  it('keeps the BR-34 override-reason minimum length', async () => {
    const fields = await rejectedFields(CreateVendorDto, { ...validVendor, branchOverrideReason: 'because' });
    expect(fields.join(' ')).toMatch(/branchOverrideReason/);
  });

  it('holds advancePct inside 0..100', async () => {
    for (const advancePct of [-1, 101]) {
      const fields = await rejectedFields(CreateVendorDto, { ...validVendor, advancePct });
      expect(fields.join(' '), `${advancePct} should be refused`).toMatch(/advancePct/);
    }
  });
});

describe('the lorry receipt — the contract of carriage', () => {
  /*
   * Every one of these passed before. `PatchLrDto` declared each section
   * `@IsObject()`, which checks that a value is an object and nothing about
   * what is in it, on the one document in the system that is a legal
   * instrument.
   */
  it('requires a consignor name — the schema constraint the DTO never mirrored', async () => {
    const fields = await rejectedFields(PatchLrDto, { consignor: { address: 'Nashik' } });
    expect(fields.join(' ')).toMatch(/name/);
  });

  it('accepts a properly formed consignor', async () => {
    await expect(
      run(PatchLrDto, { consignor: { name: 'Berger Paints', address: 'Kolkata', gstin: '19AAACB2545C1Z9' } }),
    ).resolves.toBeTruthy();
  });

  it('rejects a malformed GSTIN on a party', async () => {
    const fields = await rejectedFields(PatchLrDto, { consignee: { name: 'X', gstin: 'nope' } });
    expect(fields.join(' ')).toMatch(/GSTIN/i);
  });

  it('rejects negative or fractional money on the charge heads', async () => {
    for (const chargeHeads of [{ freightPaise: -1 }, { loadingPaise: 12.5 }, { discountPaise: -500 }]) {
      const fields = await rejectedFields(PatchLrDto, { chargeHeads });
      expect(fields.join(' '), `${JSON.stringify(chargeHeads)} should be refused`).toBeTruthy();
    }
  });

  it('rejects a negative weight and zero packages on the goods', async () => {
    expect((await rejectedFields(PatchLrDto, { goods: { weightTn: -3 } })).join(' ')).toBeTruthy();
    expect((await rejectedFields(PatchLrDto, { goods: { packages: 0 } })).join(' ')).toBeTruthy();
  });

  it('rejects an e-way bill number that is not twelve digits', async () => {
    const fields = await rejectedFields(PatchLrDto, { eway: { number: '123' } });
    expect(fields.join(' ')).toMatch(/twelve digits/i);
  });

  it('rejects a driver phone that is not a mobile', async () => {
    const fields = await rejectedFields(PatchLrDto, { driver: { name: 'S. Rathod', phone: '1' } });
    expect(fields.join(' ')).toMatch(/ten-digit/i);
  });

  it('still accepts a part-filled draft — autosave must not demand a finished document', async () => {
    // The autosave fires every 3 seconds while somebody types. Validation that
    // required a complete LR would make the feature unusable.
    await expect(run(PatchLrDto, { remarks: 'Stack no more than three high.' })).resolves.toBeTruthy();
    await expect(run(PatchLrDto, { goods: { description: 'CR steel coils' } })).resolves.toBeTruthy();
  });
});

describe('indents', () => {
  const validIndent = {
    clientId: '3f6c8b1e-6c2a-4a9e-9f1e-2b7a4c8d1e55',
    fromCity: 'Nashik',
    toCity: 'Kolkata',
    material: 'CR steel coils',
    weightTn: 19,
    truckType: '32 ft SXL',
    pickupDate: '2026-09-01',
    rateSource: 'CONTRACT' as const,
    sellRatePaise: 4680000,
  };

  it('accepts a valid contract indent', async () => {
    await expect(run(CreateIndentDto, validIndent)).resolves.toBeTruthy();
  });

  it('rejects a non-positive weight', async () => {
    for (const weightTn of [0, -5]) {
      const fields = await rejectedFields(CreateIndentDto, { ...validIndent, weightTn });
      expect(fields.join(' '), `${weightTn} should be refused`).toMatch(/weightTn/);
    }
  });
});

describe('the whitelist itself', () => {
  /*
   * This is the finding, pinned as a test rather than as prose.
   *
   * `main.ts` sets `whitelist: true` WITHOUT `forbidNonWhitelisted`, so an
   * unknown property is not rejected — it is silently removed and the request
   * succeeds without it. Three instances of the resulting data loss were
   * confirmed in the vendors module alone in a single day (fleetCount and
   * truckTypes on vendor update, notes on lead create, tripId on issue
   * create), each presenting as "200 OK, and the data just vanished".
   *
   * The test asserts the CURRENT behaviour deliberately. Changing the pipe is
   * a decision for the product owner, not something to slip in — every caller
   * currently sending a stray property starts receiving a 400 the moment it
   * ships. When that call is made, this test flips to expecting a rejection
   * and becomes the proof it took effect.
   */
  it('silently strips unknown properties instead of rejecting them', async () => {
    const result = await run<Record<string, unknown>>(CreateClientDto, {
      ...validClient,
      thisFieldDoesNotExist: 'and vanishes without a trace',
    });
    expect(result).not.toHaveProperty('thisFieldDoesNotExist');
    expect(result).toHaveProperty('name', 'Berger Paints');
  });

  it('a typo in a real field name is therefore indistinguishable from omitting it', async () => {
    // `creditDay` instead of `creditDays`. The request succeeds; the value is
    // gone. This is the whole failure mode in one line.
    const result = await run<Record<string, unknown>>(CreateClientDto, { ...validClient, creditDay: 45 });
    expect(result).not.toHaveProperty('creditDay');
    expect(result).not.toHaveProperty('creditDays');
  });
});

describe('client onboarding documents', () => {
  it('accepts a required kind', async () => {
    await expect(run(SubmitClientDocumentDto, { kind: 'GST_CERTIFICATE' })).resolves.toBeTruthy();
  });

  it('rejects a kind that is not one of the four', async () => {
    const fields = await rejectedFields(SubmitClientDocumentDto, { kind: 'PASSPORT' });
    expect(fields.join(' ')).toMatch(/kind/);
  });
});
