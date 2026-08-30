// seeds/lab-contacts.js — the vendor contact book behind the per-lab email drafts.
//
// Source of truth: the ops team's "All Vendors" workbook (vendor code, vendor
// name, Email 1..8). Each entry's `to` addresses become the draft's To: line and
// EVERY draft also carries the standard CC block below.
//
// ⚠ POLICY — this module holds addresses but CONTACTS NOBODY. It is pure data +
// pure lookup: no network, no DOM, no mail. Everything it returns ends up in the
// headers of a downloaded .eml the user reviews and sends by hand.
//
// NAME MATCHING — the workbook's vendor names and the CSV's "Performing facility
// name" are typed by different people and rarely agree character-for-character
// ('Saudi Diagnostic Limited Co.' vs 'Saudi Diagnostics Limited  Company'). So a
// lab name is matched on normalised tokens with a strict threshold, and an
// AMBIGUOUS match (two vendors scoring equally) resolves to NO match rather than
// a guess: a draft with an empty To: line is a small annoyance, a draft addressed
// to the wrong vendor leaks one lab's late-test report to another.

/**
 * CC'd on EVERY lab draft — the Lean and NUPCO follow-up group.
 */
export const STANDARD_CC = [
  'aalnaji@lean.sa',
  'Na.Alharbi@lean.sa',
  'A.a.alshehri@lean.sa',
  'Ma.Alshehri@lean.sa',
  'Raed.Alshahrani@lean.sa',
  'M.Alfadhel@lean.sa',
  'A.Alsaloom@lean.sa',
  'asamri@nupco.com',
  'yffattani@nupco.com',
  'nsbintayash@nupco.com',
];

/**
 * Per-vendor CC additions, keyed by vendor code. Saudi Diagnostic Limited gets
 * the standard block PLUS rsharbi@nupco.com; every other lab gets the block as-is.
 */
export const EXTRA_CC_BY_CODE = {
  400863: ['rsharbi@nupco.com'], // Saudi Diagnostic Limited Co.
};

/**
 * The contact book. `aliases` carry spellings seen in real order data that the
 * token matcher alone scores too low to accept.
 */
export const LAB_CONTACTS = [
  { code: '401629', vendor: 'Advanced Cell labratory', to: ['ceo@acl.com.sa', 'mahmoud.saad@acl.com.sa', 'moayyad.aman@acl.com.sa', 'ghazi.alhmidy@acl.com.sa'] },
  { code: '400897', vendor: 'Advanced Laboratory Services Compan', to: ['monazi@als.sa', 'nalanazi@als.sa', 'ralbaqami@als.sa', 'rabih.nassar@bioscientia.com'] },
  { code: '400750', vendor: 'AL Borg Medical Laboratories Co.', to: ['A.saleh@alborgdx.com', 'a.bassiouni@alborglaboratories.com'] },
  { code: '400865', vendor: 'Alarab medical laboratory', to: ['contracts@alarabgroup.co'] },
  { code: '401644', vendor: 'AlGihaz Healthcare Limited S.A', to: ['Alhanoof.Alnafisah@algihaz.com'] },
  { code: '401283', vendor: 'AlUlum Al Hayawiyyah Medical Compan', to: ['info@novo-genomics.com', 'A.BOKHARI@NOVO-GENOMICS.COM', 'H.HAQAWI@NOVO-GENOMICS.COM'], aliases: ['Novo Genomics'] },
  { code: '401478', vendor: 'Anwaa Medical Company', to: ['admin@anwa.bio', 'a.mamdouh@anwa.bio'], aliases: ['Anwa Medical Company'] },
  { code: '400022', vendor: 'Arabian Health Care Supply Company', to: ['AHCSC.Tender@ahcsc.com', 'A.Saeed@AHCSC.com'] },
  { code: '401054', vendor: 'Business center NGHA(king abdulaziz medical)', to: ['bd_claims@ngha.med.sa', 'Mohammedw@mngha.med.sa', 'alenezigh@MNGHA.MED.SA', 'MuaitherA@MNGHA.MED.SA', 'alresheedyno@MNGHA.MED.SA', 'Alrooqja@mngha.med.sa', 'bernardomi@MNGHA.MED.SA', 'GarciaS@MNGHA.MED.SA'], aliases: ['king Abdullaziz Medical city in Riyadh', 'King Abdulaziz Medical City', 'NGHA'] },
  { code: '400041', vendor: 'CIGALAH Pharmaceutical STORES', to: ['TENDER@CIGALAH.COM.SA', 'NUPCO@CIGALAH.COM.SA'] },
  { code: '401043', vendor: 'DELTA LABORATORIES MEDICAL CO', to: ['sales@delta-medlab.com'] },
  { code: '401488', vendor: 'Elsayed Elnady - National Blood and Cancer Center Company', to: ['selnady@bloodandcancer.org'], aliases: ['National Blood and Cancer Center'] },
  { code: '401470', vendor: 'Enigma Genomics', to: ['info@enigmagenomics.com'] },
  { code: '401622', vendor: 'Eurofins Clinical', to: ['medical@saudiajal.com', 'j.abdeljawad@saudiajal.com', 'ABinibrahim@saudiajal.com', 'S.alasmari@saudiajal.com'] },
  { code: '401576', vendor: 'Fal Specialized Medical Est.', to: ['kalkhenaizi@expressmedlabs.com'], aliases: ['Fal Specialized Medical Lab'] },
  { code: '400038', vendor: 'Farouk Maamon Tamer & Company', to: ['nupco.tender@tamergroup.com', 'PHARMATENDER@TAMERGROUP.COM', 'FOUAD.ABDELAL@TAMERGROUP.COM', 'ABDULAZIZ.ALRAJEH@TAMERGROUP.COM'] },
  { code: '401444', vendor: 'GENALIVE MEDICAL COMPANY', to: ['tenders@genalive.com', 'salamoudi@genalive.com'] },
  { code: '400383', vendor: 'iDeal iDea Medical Equipment Technology', to: ['info@ii-sa.com', 'WALEID@II-SA.COM', 'HAMAD@II-SA.COM'] },
  { code: '400015', vendor: 'Jazeera Pharmaceutical Industries', to: ['ookour@hikma.com', 'hraqel@hikma.com', 'bshuqqou@hikma.com'] },
  { code: '400046', vendor: 'Medical Supplies & Services Co Ltd', to: ['Tenders@mediserv.com.sa', 'A.ASKAR@MEDISERV.COM.SA'], aliases: ['Mediserv'] },
  { code: '401419', vendor: 'Noor diagnostics and discovery', to: ['customers@noordx.sa', 'Halmwafi@noordx.sa'] },
  { code: '401657', vendor: 'Pharmaceutical Investments Company', to: ['falrajhi@lifera.com.sa', 'aalhamad@lifera.com.sa', 'malbaqami@liferaomics.com.sa'], aliases: ['Lifera'] },
  { code: '401428', vendor: 'Sajaya Medical Care Services', to: ['baalzahrany@sajaya.sa'] },
  { code: '400337', vendor: 'Saud Abdul Aziz AlShalan Co. Ltd.', to: ['info@shalan-medical.com', 'ESLAM.MOHAMMED@SHALAN-MEDICAL.COM'], aliases: ['Shalan Medical'] },
  { code: '400863', vendor: 'Saudi Diagnostic Limited Co.', to: ['Binjuraida@kfshi.com.sa', 'Dairih@sdl.com.sa', 'Alayedf@sdl.com.sa'], aliases: ['Saudi Diagnostics Limited Company', 'SDL'] },
  { code: '401231', vendor: 'Soul pharma industry co.', to: ['SALES@SOUL-PHARMA.COM'] },
  { code: '401017', vendor: 'Specialized Medical Company', to: ['bassam_chahine@smc.com.sa', 'luhaidan@smc.com.sa', 'sayyed@smc.com.sa', 'Qathani@smc.com.sa', 'farhan.alanazi@smc.com.sa', 'INFO@SMC.COM.SA'] },
  { code: '401633', vendor: 'Taakde Medical center', to: ['ibrahim@taakadlab.com'], aliases: ['Taakad Medical center', 'Taakad Lab'] },
  { code: '401174', vendor: 'TAMKIN AL SEHA MEDICAL COMPANY', to: ['ramy.saad@tamkinalseha.com'] },
  { code: '401068', vendor: 'Tibyana Medical Labs Company', to: ['a.rabie@tibyana.com'] },
  { code: '401660', vendor: 'wareed medical company', to: ['info@wareed.com.sa'] },
  { code: '401894', vendor: 'Genomics Innovations Company Limite', to: ['malbaqami@liferaomics.com.sa'] },
];

// ── name normalisation ───────────────────────────────────────────────────────
// Legal-form and filler words carry no identity: 'Saudi Diagnostic Limited Co.'
// and 'Saudi Diagnostics Limited Company' must reduce to the same two tokens.
const STOPWORDS = new Set([
  'co', 'company', 'compan', 'companies', 'comp', 'ltd', 'limited', 'limite',
  'llc', 'inc', 'corp', 'corporation', 'est', 'establishment', 'the', 'and',
  'for', 'of', 'in', 'group', 'holding', 'sa', 'ksa', 'saudia',
]);

/** A lab name → identity tokens (lowercased, punctuation-free, stopwords dropped). */
export function labTokens(name) {
  const words = String(name == null ? '' : name)
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const kept = words.filter((w) => !STOPWORDS.has(w));
  // A name made ENTIRELY of stopwords keeps its words rather than becoming empty.
  return kept.length ? kept : words;
}

/** True when two tokens are the same word up to one typo/plural (≥4 chars only). */
function nearEqual(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  // Single edit (insert/delete/substitute) check — cheap two-pointer walk.
  const [s, t] = a.length >= b.length ? [a, b] : [b, a];
  let i = 0; let j = 0; let edits = 0;
  while (i < s.length && j < t.length) {
    if (s[i] === t[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (s.length === t.length) { i++; j++; } else { i++; }
  }
  return edits + (s.length - i) + (t.length - j) <= 1;
}

/**
 * Overlap score in [0,1]: shared tokens over the LONGER name's token count.
 * Dividing by the shorter one would score a generic vendor ('Specialized Medical
 * Company') a perfect 1.0 against every name that contains it, tying with — and
 * so cancelling — the specific vendor that name really belongs to.
 */
function score(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const used = new Set();
  let hits = 0;
  for (const a of aTokens) {
    for (let i = 0; i < bTokens.length; i++) {
      if (used.has(i) || !nearEqual(a, bTokens[i])) continue;
      used.add(i); hits++; break;
    }
  }
  return hits / Math.max(aTokens.length, bTokens.length);
}

// Accept only a clearly-best match: a wrong vendor would mis-address a report.
const MIN_SCORE = 0.7;

/** CC list for one entry: the standard block plus any per-vendor addition. */
function ccFor(entry) {
  const extra = (entry && EXTRA_CC_BY_CODE[entry.code]) || [];
  return [...STANDARD_CC, ...extra];
}

/**
 * Look up a lab's contacts by the name that appears in order data.
 *
 * @param {string} labName  'Performing facility name' as ingested.
 * @returns {{code:string, vendor:string, to:string[], cc:string[]}|null}
 *          null when nothing matches confidently (caller then sends no To: line).
 */
export function lookupLabContacts(labName) {
  const tokens = labTokens(labName);
  if (!tokens.length) return null;

  let best = null; let bestScore = 0; let tie = false;
  for (const entry of LAB_CONTACTS) {
    // An entry scores as the best of its official name and any alias.
    let s = score(tokens, labTokens(entry.vendor));
    for (const alias of entry.aliases || []) s = Math.max(s, score(tokens, labTokens(alias)));
    if (s > bestScore) { bestScore = s; best = entry; tie = false; }
    else if (s === bestScore && best && entry.code !== best.code) tie = true;
  }
  if (!best || bestScore < MIN_SCORE || tie) return null;
  return { code: best.code, vendor: best.vendor, to: [...best.to], cc: ccFor(best) };
}

export default LAB_CONTACTS;
