/** A catalog-selected source excerpt used to seed generation grounding. */
export interface EvidenceSeed {
  materialId?: string;
  chunkIndex?: number;
  text: string;
  /** Server-validated catalog locator within the original chunk. */
  preferredStart?: number;
}
