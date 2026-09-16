import type { DecimalString, OffsetPaginated } from './common';
import type { ScheduleClass } from './enums';

/** A hit from a salt-combination search. */
export interface SaltSearchResult {
  readonly id: string;
  readonly name: string;
  readonly schedule: ScheduleClass;
  readonly price: DecimalString;
  /**
   * The product's canonical composition key matched the query exactly, rather
   * than merely containing all the requested salts.
   *
   * `Paracetamol + Cetirizine` can be answered by a product whose key is
   * `cetirizine+paracetamol` (exact, same ingredients) and by one that also
   * contains phenylephrine (a superset). Only the first is what the pharmacist
   * asked for, so the two are ranked differently and the client can say which
   * it is showing.
   */
  readonly exact: boolean;
}

export type SaltSearchPage = OffsetPaginated<SaltSearchResult>;
