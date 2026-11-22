/**
 * The go-live import's own rules and CSV reader, borrowed from the API so the
 * browser-only demo checks an opening-balance file exactly as the server does
 * (part 12). Pure files: they import no package (shared-backend-files.test.ts).
 */
export { readTable } from '../../../internal-api/src/modules/import/csv';
export {
  missingDependencies,
  validate,
  type BalanceContext,
  type ImportSet as ApiImportSet,
} from '../../../internal-api/src/modules/import/import.rules';
