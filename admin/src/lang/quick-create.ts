import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

// GA-Q4-3 (#53) — quick-create "+" menu in the admin header. Only the
// menu title lives here: every dialog title, field label and error string
// is reused from the create page / dialog that already owns it
// (create-car, create-user, create-booking, agents, maintenance, team,
// common), exactly like #52 reused the header strings for its group
// titles — one label per area, no duplicate keys.
const strings = new LocalizedStrings({
  fr: {
    MENU_TITLE: 'Création rapide',
  },
  ar: {
    MENU_TITLE: 'إنشاء سريع',
  },
  en: {
    MENU_TITLE: 'Quick create',
  },
  es: {
    MENU_TITLE: 'Creación rápida',
  },
})

langHelper.setLanguage(strings)
export { strings }
