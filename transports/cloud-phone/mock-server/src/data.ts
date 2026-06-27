export interface RawGroup { id: string; name: string; }
export interface CloudPhoneRaw {
  id: string; name: string; status: number; os: string; size: string;
  created_at: string; expired_at: string; ip: string; area: string;
  remark: string; adb: string; adb_password: string; group: RawGroup[];
}

export function seedPhones(): CloudPhoneRaw[] {
  const groups: RawGroup[][] = [[{ id: "g1", name: "US Warmup" }], [{ id: "g2", name: "EU Pool" }], []];
  const statuses = [1, 2, 10];
  return Array.from({ length: 12 }, (_, i) => ({
    id: `cp-${100 + i}`, name: `snap_cp${100 + i}`, status: statuses[i % statuses.length],
    os: "Android 15", size: "8.87G", created_at: "1779515560", expired_at: "1782107560",
    ip: `10.0.0.${i}`, area: "United States of America(US)", remark: i % 4 === 0 ? "Username: x\nPassword: y" : "",
    adb: i % 3 === 1 ? `10.0.0.${i}:28689` : "", adb_password: "", group: groups[i % groups.length],
  }));
}
