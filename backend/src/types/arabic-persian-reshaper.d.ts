/**
 * GA-Q4-1 — minimal type declaration for arabic-persian-reshaper 1.0.1
 * (MIT). The package ships no types; the API used here is exactly the
 * two functions below (convertArabic / convertArabicBack).
 */
declare module 'arabic-persian-reshaper' {
  export interface ArabicShaperApi {
    convertArabic(text: string): string
    convertArabicBack(text: string): string
  }
  export const ArabicShaper: ArabicShaperApi
  export const PersianShaper: ArabicShaperApi
  const api: { ArabicShaper: ArabicShaperApi, PersianShaper: ArabicShaperApi }
  export default api
}
