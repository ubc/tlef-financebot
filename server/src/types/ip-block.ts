export interface IpBlockChange {
  blocked: boolean; at: Date; actorPuid: string; actorName: string; reason: string;
}
export interface IpBlockEntry {
  ip: string; blocked: boolean; revision: number; reason: string;
  updatedAt: Date; updatedByPuid: string; updatedByName: string;
  /** The latest 50 manual changes; rules remain until explicitly unblocked. */
  history: IpBlockChange[];
}
