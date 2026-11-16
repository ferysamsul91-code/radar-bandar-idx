/**
 * Klasifikasi pihak trade: asing / institusi lokal / ritel.
 * Urutan sumber: tipe investor [F]/[D] dari layar -> kode broker via brokers.json.
 * brokers.json BELUM terverifikasi; kategori broker hanya bobot, bukan kepastian.
 */
export type PartyClass = "FOREIGN" | "LOCAL_INST" | "RETAIL" | "UNKNOWN";

export type BrokerTable = Record<string, Record<string, string> | string>;

export class BrokerMap {
  private map = new Map<string, "FOREIGN_INST" | "LOCAL_INST" | "RETAIL_HEAVY">();

  constructor(table: BrokerTable) {
    for (const cat of ["FOREIGN_INST", "LOCAL_INST", "RETAIL_HEAVY"] as const) {
      const group = table[cat];
      if (group && typeof group === "object") for (const code of Object.keys(group)) this.map.set(code.toUpperCase(), cat);
    }
  }

  category(code?: string) {
    return code ? this.map.get(code.toUpperCase()) : undefined;
  }

  /**
   * [F] selalu ASING (paling akurat). [D] atau tanpa tipe: pakai kategori broker;
   * broker FOREIGN_INST dengan [D] dianggap institusi lokal (nasabah domestik).
   */
  classify(broker?: string, type?: "D" | "F"): PartyClass {
    if (type === "F") return "FOREIGN";
    const cat = this.category(broker);
    if (cat === "LOCAL_INST") return "LOCAL_INST";
    if (cat === "FOREIGN_INST") return type === "D" ? "LOCAL_INST" : "FOREIGN";
    if (cat === "RETAIL_HEAVY") return "RETAIL";
    return "UNKNOWN";
  }
}
