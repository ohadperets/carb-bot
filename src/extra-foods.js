// ─────────────────────────────────────────────────────────────
// extra-foods.js — additional foods merged into the database on startup.
//
//   • Only foods whose EXACT name is NOT already present are added, so the
//     user's existing curated values are never overwritten.
//   • Runs every boot but is a no-op once everything is present (added === 0).
//   • Scale follows the existing data:
//       carbs   = carb "portions"  (1 portion ≈ 15 g carbs)
//       fat     = fat "points"     (1 point   ≈ 5 g fat)
//       protein = grams
// ─────────────────────────────────────────────────────────────
const datastore = require('./datastore');

const EXTRA_FOODS = {
  // ─── Fruits ──────────────────────────────────────────────
  'גויאבה': { carbs: 1, fat: 0, protein: 0.7 },
  'פרי הדרקון': { carbs: 1, fat: 0, protein: 1 },
  'קרמבולה': { carbs: 0.5, fat: 0, protein: 0.5 },
  'חבוש': { carbs: 1, fat: 0, protein: 0.4 },
  'שזיף מיובש': { carbs: 1, fat: 0, protein: 0.5 },
  'חמוציות מיובשות': { carbs: 1, fat: 0, protein: 0.1 },
  'מנגו מיובש': { carbs: 1.5, fat: 0, protein: 0.5 },
  'בננה מיובשת': { carbs: 2, fat: 0, protein: 0.5 },
  'תפוח אפוי': { carbs: 1.5, fat: 0, protein: 0.5 },
  'סלט פירות': { carbs: 2, fat: 0, protein: 1 },
  'קערת פירות': { carbs: 2, fat: 0, protein: 1 },
  'אשכולית אדומה': { carbs: 1, fat: 0, protein: 0.7 },
  'תפוז דם': { carbs: 1, fat: 0, protein: 0.7 },
  'קלמנטינות': { carbs: 1, fat: 0, protein: 0.5 },
  'דובדבנים': { carbs: 1, fat: 0, protein: 0.7 },

  // ─── Vegetables & salads ────────────────────────────────
  'כרובית קלויה': { carbs: 0, fat: 0.5, protein: 2 },
  'ברוקולי מוקפץ': { carbs: 0, fat: 0.5, protein: 2.5 },
  'שעועית ירוקה': { carbs: 0, fat: 0, protein: 1.5 },
  'קישואים מוקפצים': { carbs: 0, fat: 0.5, protein: 1 },
  'חצילים בתנור': { carbs: 0, fat: 0.5, protein: 1 },
  'פלפלים קלויים': { carbs: 0.25, fat: 0.2, protein: 1 },
  'תפוח אדמה אפוי': { carbs: 2, fat: 0.1, protein: 2 },
  'בטטה אפויה': { carbs: 2, fat: 0.1, protein: 2 },
  'ירקות מוקפצים': { carbs: 0.5, fat: 0.5, protein: 2 },
  'ירקות בגריל': { carbs: 0.25, fat: 0.3, protein: 1.5 },
  'ירקות בתנור': { carbs: 0.5, fat: 0.5, protein: 2 },
  'סלט קצוץ': { carbs: 0, fat: 0, protein: 1 },
  'סלט ירקות': { carbs: 0, fat: 0, protein: 1 },
  'סלט ישראלי': { carbs: 0, fat: 0.2, protein: 1 },
  'סלט יווני': { carbs: 0.25, fat: 1.5, protein: 3 },
  'סלט כרוב': { carbs: 0.25, fat: 1, protein: 1 },
  'סלט גזר': { carbs: 0.5, fat: 0.5, protein: 1 },
  'סלט סלק': { carbs: 0.5, fat: 0.3, protein: 1 },
  'סלט טונה': { carbs: 0, fat: 1, protein: 15 },
  'סלט ביצים': { carbs: 0, fat: 2, protein: 8 },
  'סלט אבוקדו': { carbs: 0.5, fat: 3, protein: 2 },
  'סלט קינואה': { carbs: 1, fat: 0.7, protein: 5 },
  'סלט פסטה': { carbs: 2, fat: 1, protein: 5 },
  'סלט חסה': { carbs: 0, fat: 0, protein: 1 },
  'כרוב מוקפץ': { carbs: 0, fat: 0.5, protein: 1.5 },
  'תירס חופשי': { carbs: 1, fat: 0.2, protein: 2 },

  // ─── Meat, poultry & fish ───────────────────────────────
  'אנטריקוט': { carbs: 0, fat: 4, protein: 25 },
  'פילה בקר': { carbs: 0, fat: 2, protein: 26 },
  'אסאדו': { carbs: 0, fat: 5, protein: 22 },
  'צלי בקר': { carbs: 0, fat: 3, protein: 24 },
  'כתף כבש': { carbs: 0, fat: 4, protein: 20 },
  'צלעות כבש': { carbs: 0, fat: 4, protein: 20 },
  'שניצל הודו': { carbs: 1, fat: 1.5, protein: 20 },
  'כבד קצוץ': { carbs: 0.25, fat: 2, protein: 12 },
  'לבבות עוף': { carbs: 0, fat: 1.5, protein: 16 },
  'חזה עוף בגריל': { carbs: 0, fat: 0.6, protein: 26 },
  'שוקיים עוף': { carbs: 0, fat: 2.5, protein: 18 },
  'סלמון על הגריל': { carbs: 0, fat: 2.5, protein: 22 },
  'טונה צרובה': { carbs: 0, fat: 1, protein: 24 },
  'פילה אמנון': { carbs: 0, fat: 0.5, protein: 20 },
  'בקלה': { carbs: 0, fat: 0.5, protein: 18 },
  'שרימפס': { carbs: 0, fat: 0.5, protein: 20 },
  'קלמארי': { carbs: 0.5, fat: 1.5, protein: 15 },
  'אדממה': { carbs: 0.5, fat: 0.5, protein: 6 },
  'טופו מוקפץ': { carbs: 0.25, fat: 1, protein: 9 },
  'אומלט ירקות': { carbs: 0, fat: 1.5, protein: 8 },
  'פריטטה': { carbs: 0.25, fat: 1.5, protein: 8 },
  'חביתת חלבונים': { carbs: 0, fat: 0.2, protein: 8 },

  // ─── Grains, rice, pasta & breads ───────────────────────
  'אורז מלא': { carbs: 2, fat: 0.2, protein: 4 },
  'אורז בסמטי': { carbs: 2, fat: 0.1, protein: 4 },
  'אורז עם ירקות': { carbs: 2, fat: 0.5, protein: 5 },
  'אורז מוקפץ': { carbs: 2, fat: 1, protein: 5 },
  'ספגטי': { carbs: 2, fat: 0.4, protein: 7 },
  'פנה': { carbs: 2, fat: 0.4, protein: 7 },
  'רביולי': { carbs: 2, fat: 2, protein: 8 },
  'טורטליני': { carbs: 2, fat: 2, protein: 8 },
  'פסטה מלאה': { carbs: 2, fat: 0.4, protein: 8 },
  'ג׳בטה': { carbs: 2, fat: 0.5, protein: 5 },
  'בייגל': { carbs: 4, fat: 0.5, protein: 8 },
  'בייגלה': { carbs: 1, fat: 0.3, protein: 1 },
  'פרצל': { carbs: 2, fat: 0.5, protein: 3 },
  'ראפ': { carbs: 3, fat: 2, protein: 12 },
  'כריך גבינה': { carbs: 3, fat: 2, protein: 12 },
  'כריך טונה': { carbs: 3, fat: 2, protein: 18 },
  'כריך ביצה': { carbs: 3, fat: 2, protein: 12 },
  'כריך אבוקדו': { carbs: 3, fat: 3, protein: 8 },
  'אנגליש מאפין': { carbs: 2, fat: 0.5, protein: 5 },
  'קרקרים מלאים': { carbs: 1, fat: 0.4, protein: 1.5 },

  // ─── International dishes ────────────────────────────────
  'בוריטו': { carbs: 5, fat: 4, protein: 18 },
  'טאקו': { carbs: 2, fat: 2, protein: 8 },
  'קסדייה': { carbs: 3, fat: 3, protein: 10 },
  'נאצ׳וס': { carbs: 3, fat: 3, protein: 5 },
  'אנצ׳ילדה': { carbs: 3, fat: 3, protein: 10 },
  'פאחיטס': { carbs: 3, fat: 3, protein: 15 },
  'קארי': { carbs: 1, fat: 2, protein: 10 },
  'קארי ירקות': { carbs: 1, fat: 1.5, protein: 4 },
  'ביריאני': { carbs: 3, fat: 2, protein: 10 },
  'ריזוטו': { carbs: 3, fat: 3, protein: 6 },
  'פאייה': { carbs: 3, fat: 2, protein: 10 },
  'גולאש': { carbs: 1, fat: 2, protein: 18 },
  'פו': { carbs: 3, fat: 1, protein: 10 },
  'גיוזה': { carbs: 1, fat: 1, protein: 4 },
  'ביבימבאפ': { carbs: 3, fat: 2, protein: 12 },
  'סביח': { carbs: 3, fat: 3, protein: 10 },
  'סביח בפיתה': { carbs: 4, fat: 4, protein: 12 },
  'פלאפל בפיתה': { carbs: 4, fat: 2, protein: 8 },
  'פיש אנד צ׳יפס': { carbs: 4, fat: 5, protein: 18 },
  'מנת פלאפל': { carbs: 2, fat: 2.5, protein: 10 },

  // ─── Dairy & yogurts ────────────────────────────────────
  'גבינת חלומי': { carbs: 0, fat: 1.4, protein: 7 },
  'חלומי קלוי': { carbs: 0, fat: 1.6, protein: 8 },
  'מילקי': { carbs: 1.5, fat: 1, protein: 2 },
  'דנונה': { carbs: 1.5, fat: 0.5, protein: 4 },
  'אקטימל': { carbs: 1, fat: 0.2, protein: 2 },
  'יופלה': { carbs: 1.5, fat: 0.5, protein: 4 },
  'יוגורט פרוטאין': { carbs: 0.5, fat: 0.2, protein: 18 },
  'מעדן שוקולד': { carbs: 2, fat: 1, protein: 3 },
  'מעדן וניל': { carbs: 2, fat: 1, protein: 3 },
  'פודינג': { carbs: 2, fat: 1, protein: 3 },
  'חלב שקדים': { carbs: 0.25, fat: 0.5, protein: 1 },
  'חלב שיבולת שועל': { carbs: 1, fat: 0.5, protein: 1 },
  'חלב סויה': { carbs: 0.5, fat: 0.7, protein: 7 },
  'חלב קוקוס': { carbs: 0.5, fat: 2, protein: 1 },

  // ─── Nuts, seeds & spreads ──────────────────────────────
  'חמאת קשיו': { carbs: 0.5, fat: 1.5, protein: 3 },
  'טחינה גולמית': { carbs: 0.25, fat: 1.8, protein: 3 },
  'ממרח תמרים': { carbs: 1, fat: 0, protein: 0.3 },
  'ריבת חלב': { carbs: 1, fat: 0.5, protein: 1 },
  'תערובת אגוזים': { carbs: 0.5, fat: 3, protein: 4 },
  'פיצוחים': { carbs: 0.5, fat: 2.5, protein: 5 },
  'גרעינים': { carbs: 0.25, fat: 2.5, protein: 5 },
  'חטיף תמרים': { carbs: 1.5, fat: 0.5, protein: 2 },

  // ─── Snacks & sweets ────────────────────────────────────
  'מנטוס': { carbs: 0.5, fat: 0, protein: 0 },
  'סוכריות גומי': { carbs: 1, fat: 0, protein: 1 },
  'מסטיק': { carbs: 0, fat: 0, protein: 0 },
  'קרמבו': { carbs: 1.5, fat: 1, protein: 1 },
  'וופלים': { carbs: 1.5, fat: 1, protein: 1 },
  'עוגיות אוראו': { carbs: 1, fat: 0.5, protein: 0.5 },
  'אפרופו': { carbs: 1.5, fat: 1, protein: 2 },
  'דוריטוס': { carbs: 2, fat: 2, protein: 2 },
  'פרינגלס': { carbs: 2, fat: 2, protein: 2 },
  'חטיף תירס': { carbs: 1.5, fat: 1, protein: 1 },
  'קליק': { carbs: 1, fat: 1, protein: 1 },
  'כיף כף': { carbs: 1.5, fat: 1.5, protein: 1.5 },
  'פסק זמן': { carbs: 1, fat: 1, protein: 1.5 },
  'מקופלת': { carbs: 1, fat: 1, protein: 1 },
  'שלגון': { carbs: 1.5, fat: 1, protein: 1 },
  'קרטיב': { carbs: 1, fat: 0, protein: 0 },

  // ─── Drinks ─────────────────────────────────────────────
  'מילקשייק שוקולד': { carbs: 4, fat: 2, protein: 6 },
  'שוקו': { carbs: 1.5, fat: 0.8, protein: 4 },
  'אייס קפה': { carbs: 1.5, fat: 0.8, protein: 3 },
  'אספרסו': { carbs: 0, fat: 0, protein: 0 },
  'מקיאטו': { carbs: 0.25, fat: 0.3, protein: 1 },
  'אמריקנו': { carbs: 0, fat: 0, protein: 0 },
  'תה קר': { carbs: 1.5, fat: 0, protein: 0 },
  'מיץ רימונים': { carbs: 3, fat: 0, protein: 0.5 },
  'מיץ עגבניות': { carbs: 1, fat: 0, protein: 1 },
  'נקטר': { carbs: 3, fat: 0, protein: 0.3 },
  'שוופס': { carbs: 2.5, fat: 0, protein: 0 },
  'טוניק': { carbs: 2, fat: 0, protein: 0 },
  'שייק חלבון בננה': { carbs: 2, fat: 0.5, protein: 25 },

  // ─── Soups & home dishes ────────────────────────────────
  'מרק מינסטרונה': { carbs: 1, fat: 0.5, protein: 3 },
  'מרק בצל': { carbs: 0.5, fat: 0.5, protein: 2 },
  'מרק פטריות': { carbs: 0.5, fat: 1, protein: 2 },
  'מרק אפונה': { carbs: 1, fat: 0.3, protein: 5 },
  'מרק דלעת': { carbs: 1, fat: 0.5, protein: 2 },
  'חמין': { carbs: 2, fat: 2, protein: 12 },
  'תבשיל שעועית': { carbs: 1.5, fat: 1, protein: 8 },
  'תבשיל עדשים': { carbs: 1.5, fat: 0.5, protein: 8 },
  'ממולאים': { carbs: 1.5, fat: 1, protein: 5 },
  'קציצות ברוטב': { carbs: 0.5, fat: 2, protein: 12 },
  'כדורי בשר ברוטב': { carbs: 0.5, fat: 2, protein: 12 },
  'פשטידת תפוחי אדמה': { carbs: 1.5, fat: 1, protein: 4 },
  'פשטידת קישואים': { carbs: 0.25, fat: 0.8, protein: 4 },
  'פשטידת בטטה': { carbs: 1.5, fat: 1, protein: 4 },
  'לזניה ירקות': { carbs: 3, fat: 3, protein: 9 },

  // ─── Bakery & breakfast ─────────────────────────────────
  'דניש': { carbs: 3, fat: 2.5, protein: 4 },
  'שטרודל': { carbs: 3, fat: 2, protein: 3 },
  'קרואסון שקדים': { carbs: 3, fat: 3.5, protein: 6 },
  'בורקס תפוחי אדמה': { carbs: 2, fat: 2, protein: 4 },
  'בורקס פיצה': { carbs: 1.5, fat: 2, protein: 4 },
  'מאפה גבינה': { carbs: 2, fat: 2, protein: 5 },
  'פנקייק חלבון': { carbs: 1, fat: 0.5, protein: 12 },
  'ארוחת בוקר ישראלית': { carbs: 2, fat: 3, protein: 15 },
};

async function mergeExtraFoods() {
  const foods = datastore.read('foods', {});
  let added = 0;
  for (const [name, val] of Object.entries(EXTRA_FOODS)) {
    if (!(name in foods)) {
      foods[name] = val;
      added++;
    }
  }
  if (added > 0) {
    datastore.write('foods', foods);
    await datastore.flush();
  }
  console.log(`🍽️  Extra foods merge: ${added} new food(s) added (${Object.keys(foods).length} total).`);
  return added;
}

module.exports = { mergeExtraFoods, EXTRA_FOODS };
