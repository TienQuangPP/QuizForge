/** Lower-case, accent-free form used for search and matching ("Đường" → "duong"). */
export const normalize = (s: string) =>
  s.toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
