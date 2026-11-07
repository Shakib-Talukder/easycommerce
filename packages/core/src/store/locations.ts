import data from "../../data/bd-locations.json";

/** Bangladesh's 8 divisions and 64 districts (static data, safe for client components). */
export type District = { id: string; bn: string; en: string };
export type Division = { id: string; bn: string; en: string; districts: District[] };

export const DIVISIONS: readonly Division[] = data.divisions;

export function findDivision(id: string | null | undefined): Division | undefined {
  return DIVISIONS.find((d) => d.id === id);
}

export function findDistrict(
  divisionId: string | null | undefined,
  districtId: string | null | undefined,
): District | undefined {
  return findDivision(divisionId)?.districts.find((d) => d.id === districtId);
}
