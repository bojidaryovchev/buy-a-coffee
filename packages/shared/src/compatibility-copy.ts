/**
 * What product copy may promise about the machine a capsule goes in.
 *
 * A compatibility sentence is a promise that a box fits a machine, and four
 * the shop used to make were contradicted by the machine makers' own
 * statements (research `08` §1):
 *
 *  - **Dolce Gusto NEO** machines take only NEO paper pods; the classic capsule
 *    does not go in them. „Машини Dolce Gusto“ includes them, so a classic
 *    capsule is „съвместима с класическите машини Dolce Gusto (не NEO)“.
 *  - **Nespresso Vertuo** is a home machine too, and takes only Vertuo
 *    capsules. „Домашни машини Nespresso“ includes it, and so does a bare
 *    „машини Nespresso“; the Original capsule is for „класическите машини
 *    Nespresso (Original)“, or „машини Nespresso Original“.
 *  - **K-fee** is a system of its own (K-fee's capsules and Aldi's EXPRESSI),
 *    not the Caffitaly format, and Caffitaly says its capsules work only in
 *    machines marked Caffitaly System. Copy names K-fee only to say so.
 *  - **Tchibo Cafissimo** takes the Caffitaly format, but Tchibo tells its
 *    owners to use only its own capsules. Copy may say the format fits; it
 *    then says Tchibo's word as well.
 *
 * One definition, for every place that publishes or guards product copy: the
 * catalog copywriter's audit (`@catalog/scraper-core`, where a machine-written
 * text that breaks it is rejected rather than published), the storefront's test
 * of the hand-written copy file, and `copy:compat`, which reads what a database
 * already publishes. Pure and dependency-free, like everything in this package,
 * so a test, a script and the copywriter can all use it.
 *
 * WHAT IT READS. Patterns over Bulgarian, not a parser, so the rules are kept
 * to the three shapes a wrong promise takes. Every one of them has been run
 * over the whole hand-written catalogue, which passes, and over the wording it
 * replaced, which does not (`packages/shared/test/compatibility-copy.test.ts`):
 *
 *  1. A machine phrase — „машини Dolce Gusto“, „машините Nespresso“, „Dolce
 *     Gusto машини“ — speaks for every machine of the name, so it carries the
 *     qualifier that leaves out the one that does not fit: „класическите“ with
 *     NEO excluded, or Original straight after the name.
 *  2. A name that is only ever named to be excluded — NEO, Vertuo, K-fee —
 *     stands beside a negation („не NEO“, „не с Vertuo“, „не пасват в тях“) or
 *     a statement that it is a system of its own („K-fee е отделна система“).
 *  3. A promise that holds only with something said beside it — "these fit a
 *     Cafissimo" without Tchibo's caveat, „съвместими с Dolce Gusto“ with NEO
 *     never excluded — is judged over the whole text, the way a reader meets
 *     it: the caveat may be in the next sentence or the next paragraph.
 *
 * WHAT IT LETS THROUGH, on purpose. A system's name on its own is not a promise
 * about machines: „Капсули за Dolce Gusto“ is what the product is, how the
 * shelf and the category are named, and how search spells it. Nor is a
 * negative sentence: „Капсула за Dolce Gusto не влиза в машина Nespresso“ is
 * true of every Nespresso.
 *
 * WHAT IT ASSUMES. That the shop sells no NEO pods, Vertuo capsules or K-fee
 * capsules — true of the catalogue, whose capsule formats are Dolce Gusto,
 * Nespresso (Original), Lavazza Blue, A Modo Mio and Caffitaly
 * (`product-name.ts`). Copy for such a product would have to name its own
 * machine, and these rules would first have to learn the product's system.
 */

/** Which promise a text broke. Stable: tests, logs and reports key on it. */
export type CompatibilityRule =
  /** „машини Dolce Gusto“ without „класическите“, or with NEO excluded nowhere. */
  | "dolce-gusto-machines"
  /** NEO named as a machine the capsules suit. */
  | "dolce-gusto-neo"
  /** A fit with Dolce Gusto promised, and NEO excluded nowhere in the text. */
  | "dolce-gusto-unqualified"
  /** „домашни(те) машини Nespresso“: Vertuo is a home machine too. */
  | "nespresso-home"
  /** „машини Nespresso“ without Original. */
  | "nespresso-machines"
  /** Vertuo named as a machine the capsules suit. */
  | "nespresso-vertuo"
  /** A fit with Nespresso promised, and Original named nowhere in the text. */
  | "nespresso-unqualified"
  /** K-fee (or EXPRESSI) named as a machine the capsules suit. */
  | "k-fee"
  /** Tchibo Cafissimo named as a machine the capsules suit, without Tchibo's caveat. */
  | "tchibo-cafissimo";

export interface CompatibilityProblem {
  readonly rule: CompatibilityRule;
  /** The words that make the promise: „машини Dolce Gusto“. */
  readonly phrase: string;
  /** The sentence they stand in. */
  readonly sentence: string;
  /** What is wrong and what to write instead, in Bulgarian, for the owner. */
  readonly reason: string;
}

/**
 * The wording that is right, as the hand-written copy uses it and the
 * copywriter's skill teaches it. Each passes every rule here, and the skill
 * file quotes each one (both tested), so the rules and what the model is told
 * cannot drift apart.
 */
export const COMPATIBILITY_WORDING = {
  dolceGusto: "съвместими с класическите машини Dolce Gusto (не NEO)",
  nespresso: "съвместими с класическите машини Nespresso (Original)",
  nespressoOriginal: "машини Nespresso Original",
  vertuo: "не с Vertuo",
  kFee: "K-fee е отделна система",
  cafissimo: "Tchibo посочва, че в Cafissimo трябва да се използват само нейните капсули",
} as const;

/* --- Words ---------------------------------------------------------------- */

/*
 * Bounded by lookarounds, not `\b`: `\b` knows only ASCII letters, so it would
 * find a word boundary inside every Bulgarian word.
 */
const START = "(?<![\\p{L}\\p{N}])";
const END = "(?![\\p{L}\\p{N}])";
const MARK = "[®™]?";

const DOLCE_GUSTO = `(?:(?:Nescaf[eé]|NESCAF[EÉ]|Нескафе)\\s+)?(?:Dolce[\\s-]?Gusto|DOLCE[\\s-]?GUSTO|Долче[\\s-]?Густо)${MARK}`;
const NESPRESSO = `(?:Nespresso|NESPRESSO|Неспресо)${MARK}`;
/** „машина“, „машините“, „кафемашини“, „машинка“. */
const MACHINE = "(?:кафе)?машин\\p{L}*";
/** „машини на Dolce Gusto“, „машините от системата Nespresso“. */
const LINK = "(?:\\s+(?:на|от|за))?(?:\\s+(?:системата|марката))?";

const machinesOf = (system: string) =>
  new RegExp(`${START}${MACHINE}${LINK}\\s+${system}|${START}${system}\\s+${MACHINE}`, "giu");

const DOLCE_GUSTO_MACHINES = machinesOf(DOLCE_GUSTO);
const NESPRESSO_MACHINES = machinesOf(NESPRESSO);
const NESPRESSO_HOME_MACHINES = new RegExp(
  `${START}домашн\\p{L}*\\s+(?:${MACHINE}${LINK}\\s+${NESPRESSO}|${NESPRESSO}\\s+${MACHINE})|${START}${NESPRESSO}\\s+домашн\\p{L}*\\s+${MACHINE}`,
  "giu",
);
const DOLCE_GUSTO_NAME = new RegExp(`${START}${DOLCE_GUSTO}`, "giu");
const NESPRESSO_NAME = new RegExp(`${START}${NESPRESSO}`, "giu");

/*
 * Case-sensitive: the system is written NEO (or Neo), and a lower-case „нео“
 * or a hyphenated „Нео-“ is the start of some other word.
 */
const NEO = /(?<![\p{L}\p{N}])(?:NEO|Neo|НЕО|Нео)(?![\p{L}\p{N}-])/gu;
const VERTUO = /(?<![\p{L}\p{N}])(?:Vertuo|VERTUO|Вертуо)\p{L}*/gu;
const K_FEE = /(?<![\p{L}\p{N}])(?:K[\s‑–-]?(?:fee|Fee|FEE)|EXPRESSI|Expressi)(?![\p{L}\p{N}])/gu;
/** Cafissimo, or a machine of Tchibo's that is not a Qbo (a system of its own). */
const CAFISSIMO = new RegExp(
  `${START}(?:Cafissimo|CAFISSIMO|Кафисимо)${END}|${START}${MACHINE}(?:\\s+(?:на|от))?\\s+(?:Tchibo|TCHIBO|Чибо)${END}(?!\\s+Qbo)`,
  "giu",
);

/** What follows a machine phrase that is about another machine of the name. */
const ABOUT_NEO = /^\s*\(?\s*(?:NEO|Neo|НЕО|Нео)(?![\p{L}\p{N}])/u;
const NAMES_ORIGINAL = /^\s*\(?\s*(?:Original|ORIGINAL|Оригинал)/u;
const ABOUT_OTHER_NESPRESSO = /^\s*(?:Vertuo|VERTUO|Вертуо|Professional|Pro)(?![\p{L}\p{N}])/u;
const ORIGINAL_NAMED = new RegExp(`${NESPRESSO}\\s*\\(?\\s*(?:Original|ORIGINAL|Оригинал)`, "u");

/**
 * Words that promise a fit: „съвместими с“, „пасват на“, „влизат в“, „стават
 * за“, „работят в“, „подходящи за“. Only these, a few words before a system's
 * name in the same clause, make the name a promise; „капсули за Dolce Gusto“
 * names the product, and „с мляко става лате, а капсулите са за Dolce Gusto“
 * says nothing about machines.
 */
const FIT_WORD =
  /^(?:съвместим|пасва|пасват|пасващ|влиза|влизат|влизащ|става|стават|работи|работят|подходящ|предназначен|годн)\p{L}*$/iu;

/**
 * A fit denied: „не пасват“, „не ги приемат“, „няма да паснат“, „не са
 * съвместими“. Preceded by a contrast („…, но не пасват на Nespresso“) it is
 * about something else, and the first group says so.
 */
const FIT_DENIED =
  /(?<![\p{L}\p{N}])(?:(но|а|ала|обаче)\s+)?(?:не|нито|няма\s+да)\s+(?:(?:са|е|ги|го|ще|могат|може|бива|се|и)\s+){0,2}(?:да\s+)?(?:съвместим|пас|влиз|влез|став|работ|прием|подходящ|годн)\p{L}*/giu;

/**
 * A machine that takes only its own: „Vertuo приема само собствените си
 * капсули“, „NEO работи само с хартиени дози“.
 */
const ONLY_ITS_OWN =
  /(?<![\p{L}\p{N}])(?:приема|приемат|работи|работят|използва|използват)\s+(?:[\p{L}-]+\s+){0,2}?(?:само|единствено)(?![\p{L}\p{N}])/iu;

/**
 * „Собствена система“, „отделна система“, „други системи“, „друг формат“,
 * „несъвместими системи“, „различна от Caffitaly“: the sentence says the name
 * is a system apart.
 */
const SEPARATE_SYSTEM =
  /(?<![\p{L}\p{N}])(?:(?:отделн|самостоятелн|собствен|различн|несъвместим|друг)\p{L}*\s+(?:[\p{L}-]+\s+)?(?:систем|формат)\p{L}*|различн\p{L}*\s+от)(?![\p{L}\p{N}])/iu;

/**
 * Tchibo's word on the Cafissimo: only its own capsules, or the warranty that
 * other makers' capsules can cost. Said by Tchibo, or by „производителят на
 * машината“, as the product page's general caveat words it.
 */
const CAFISSIMO_CAVEAT_WHO = /(?:Tchibo|TCHIBO|Чибо|производител\p{L}*\s+на\s+машин\p{L}*)/iu;
const OWN_CAPSULES_ONLY = /(?<![\p{L}\p{N}])(?:само|единствено)\s+(?:[\p{L}-]+\s+){0,3}?капсул/iu;
/** The warranty, and that other capsules can cost it — not "two years' warranty". */
const WARRANTY = /гаранци/iu;
const WARRANTY_LIMIT = /(?<![\p{L}\p{N}])(?:не|няма|чужд\p{L}*|друг\p{L}*)(?![\p{L}\p{N}])/iu;

function givesCafissimoCaveat(sentence: string): boolean {
  if (!CAFISSIMO_CAVEAT_WHO.test(sentence)) return false;
  return (
    OWN_CAPSULES_ONLY.test(sentence) || (WARRANTY.test(sentence) && WARRANTY_LIMIT.test(sentence))
  );
}

const NEGATION = new Set(["не", "нито", "няма", "нямаме"]);
/**
 * „Без NEO“, „освен Vertuo“ — only straight before a name. Further off they
 * are about something else („работи без проблем и с NEO“), and after one too
 * („K-fee без адаптер“).
 */
const EXCLUDING = new Set(["без", "освен"]);
const EXCLUDING_WORDS = 2;
/** „не за Nespresso, а за K-fee“: what follows the contrast is affirmed. */
const CONTRAST = new Set(["но", "а", "ала", "обаче", "ами"]);
/** How near a negation must stand to the name it negates. */
const WORDS_BEFORE = 5;
const WORDS_AFTER = 3;

const WORD = /[\p{L}\p{N}]+/gu;
/** A clause ends here: a negation on the far side is about something else. */
const CLAUSE_BREAK = /[,;:()—–]/;

/* --- Reading ----------------------------------------------------------------- */

/**
 * Sentences, as the rules read them: one per line, and a new one after `.`,
 * `!`, `?` or `…` where the next word starts like a sentence, so „16 бр. в
 * кутия“ stays whole.
 */
export function compatibilitySentences(text: string | readonly string[]): string[] {
  const fields = typeof text === "string" ? [text] : text;
  return fields
    .flatMap((field) => field.split(/\n+/))
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .flatMap((line) => line.split(/(?<=[.!?…])\s+(?=[„"«(\p{Lu}\p{N}])/u))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** Every match of a global pattern, with where it starts and ends. */
function matchesOf(pattern: RegExp, sentence: string) {
  return [...sentence.matchAll(pattern)].map((match) => ({
    phrase: match[0].trim(),
    index: match.index,
    end: match.index + match[0].length,
    contrast: match[1] !== undefined,
  }));
}

/** The words of the clause before `index`, nearest last. */
function wordsBefore(sentence: string, index: number): string[] {
  const before = sentence.slice(0, index);
  let cut = -1;
  for (let i = before.length - 1; i >= 0; i -= 1) {
    if (CLAUSE_BREAK.test(before[i] as string)) {
      cut = i;
      break;
    }
  }
  return [...before.slice(cut + 1).matchAll(WORD)].map((match) => match[0].toLowerCase());
}

/** The words of the clause after `end`, nearest first. */
function wordsAfter(sentence: string, end: number): string[] {
  const after = sentence.slice(end);
  const cut = after.search(CLAUSE_BREAK);
  return [...(cut === -1 ? after : after.slice(0, cut)).matchAll(WORD)].map((match) =>
    match[0].toLowerCase(),
  );
}

/**
 * Whether the phrase at `index..end` is negated: by a negation among the few
 * words before it in its clause („не влизат в машини Nespresso“, „(не NEO)“)
 * with no contrast in between. For a name named to be excluded (`name`), also
 * „без“ or „освен“ straight before it („освен Vertuo“), and a negation straight
 * after it, as its verb („K-fee не приема“).
 */
function negated(sentence: string, index: number, end: number, name: boolean): boolean {
  const before = wordsBefore(sentence, index).slice(-WORDS_BEFORE).reverse();
  for (const [distance, word] of before.entries()) {
    if (CONTRAST.has(word)) break;
    if (NEGATION.has(word)) return true;
    if (name && distance < EXCLUDING_WORDS && EXCLUDING.has(word)) return true;
  }
  if (!name) return false;
  for (const word of wordsAfter(sentence, end).slice(0, WORDS_AFTER)) {
    if (CONTRAST.has(word)) break;
    if (NEGATION.has(word)) return true;
  }
  return false;
}

/**
 * Whether the name at `index..end` is named only to be excluded: negated, set
 * apart as a system of its own, or followed in its sentence by what it alone
 * takes or by a denied fit („Машините Vertuo приемат само собствените си
 * капсули и тези не пасват в тях“).
 */
function excluded(sentence: string, index: number, end: number): boolean {
  if (negated(sentence, index, end, true)) return true;
  if (SEPARATE_SYSTEM.test(sentence)) return true;
  const rest = sentence.slice(end);
  if (ONLY_ITS_OWN.test(rest)) return true;
  return matchesOf(FIT_DENIED, rest).some((denial) => !denial.contrast);
}

/**
 * Whether a sentence names `name` only to exclude it. Once one mention is
 * excluded, the others in the sentence are the same machine named again
 * („Vertuo чете баркод… и приема само капсули Vertuo“).
 */
function excludes(sentence: string, name: RegExp): boolean {
  return matchesOf(name, sentence).some(({ index, end }) => excluded(sentence, index, end));
}

/** Whether a sentence excludes NEO: „(не NEO)“, „освен NEO“, „NEO е отделна система“. */
const excludesNeo = (sentence: string) => excludes(sentence, NEO);

/** Whether one of the two words before `index` starts with `stem`. */
function qualifiedBy(sentence: string, index: number, stem: string): boolean {
  return wordsBefore(sentence, index)
    .slice(-2)
    .some((word) => word.startsWith(stem));
}

/**
 * The first place in a sentence where a fit word stands a few words before a
 * system's name, in its clause, and is not negated — „съвместими с Dolce
 * Gusto“, „пасват на всички Nespresso“ — passing over names followed by
 * `aboutOther` (NEO, Original...).
 */
function fitPromise(
  sentence: string,
  name: RegExp,
  aboutOther: readonly RegExp[],
): { phrase: string } | null {
  for (const mention of matchesOf(name, sentence)) {
    const rest = sentence.slice(mention.end);
    if (aboutOther.some((pattern) => pattern.test(rest))) continue;
    if (negated(sentence, mention.index, mention.end, false)) continue;
    const near = wordsBefore(sentence, mention.index).slice(-WORDS_BEFORE);
    const fit = near.find((word) => FIT_WORD.test(word));
    if (!fit) continue;
    const from = sentence.toLowerCase().lastIndexOf(fit, mention.index);
    return { phrase: sentence.slice(from, mention.end) };
  }
  return null;
}

/* --- The rules ------------------------------------------------------------------- */

const REASON: Record<CompatibilityRule, (phrase: string) => string> = {
  "dolce-gusto-machines": (phrase) =>
    `„${phrase}“ включва и машините Dolce Gusto NEO, в които класическата капсула не влиза: пишете „${COMPATIBILITY_WORDING.dolceGusto}“`,
  "dolce-gusto-neo": (phrase) =>
    `„${phrase}“ е назовано като машина, за която стават: NEO приема само хартиените дози NEO, не класическите капсули Dolce Gusto`,
  "dolce-gusto-unqualified": (phrase) =>
    `„${phrase}“ обещава съвместимост с Dolce Gusto, а текстът никъде не изключва NEO: пишете „${COMPATIBILITY_WORDING.dolceGusto}“`,
  "nespresso-home": (phrase) =>
    `„${phrase}“ включва и Vertuo, която също е домашна машина и приема само капсули Vertuo: пишете „${COMPATIBILITY_WORDING.nespresso}“`,
  "nespresso-machines": (phrase) =>
    `„${phrase}“ включва и Vertuo, която приема само капсули Vertuo: пишете „${COMPATIBILITY_WORDING.nespresso}“ или „${COMPATIBILITY_WORDING.nespressoOriginal}“`,
  "nespresso-vertuo": (phrase) =>
    `„${phrase}“ е назовано като машина, за която стават: Vertuo приема само капсули Vertuo`,
  "nespresso-unqualified": (phrase) =>
    `„${phrase}“ обещава съвместимост с Nespresso, а текстът никъде не назовава Original: пишете „${COMPATIBILITY_WORDING.nespresso}“`,
  "k-fee": (phrase) =>
    `„${phrase}“ е назовано като машина, за която стават: K-fee е отделна система (капсули K-fee и EXPRESSI), не формат Caffitaly`,
  "tchibo-cafissimo": (phrase) =>
    `„${phrase}“ обещава, че капсулите стават за Tchibo Cafissimo, без уговорката на Tchibo: добавете „${COMPATIBILITY_WORDING.cafissimo}“`,
};

function problem(rule: CompatibilityRule, phrase: string, sentence: string): CompatibilityProblem {
  return { rule, phrase, sentence, reason: REASON[rule](phrase) };
}

/**
 * Every broken compatibility promise in one product's text — its summary and
 * body paragraphs together, as the page shows them. An empty list is copy that
 * may be published.
 *
 * Sentence rules report every phrase that breaks them. The rules over the
 * whole text report their first promise, and only when no sentence about the
 * same system was reported already: one fix answers both.
 */
export function compatibilityProblems(text: string | readonly string[]): CompatibilityProblem[] {
  const sentences = compatibilitySentences(text);
  const whole = sentences.join(" ");
  const mentionsDolceGusto = new RegExp(DOLCE_GUSTO_NAME.source, "iu").test(whole);
  const textExcludesNeo = sentences.some(excludesNeo);
  const textNamesOriginal = ORIGINAL_NAMED.test(whole);
  const problems: CompatibilityProblem[] = [];

  for (const sentence of sentences) {
    for (const mention of matchesOf(DOLCE_GUSTO_MACHINES, sentence)) {
      if (ABOUT_NEO.test(sentence.slice(mention.end))) continue;
      if (negated(sentence, mention.index, mention.end, false)) continue;
      if (qualifiedBy(sentence, mention.index, "класическ") && textExcludesNeo) continue;
      problems.push(problem("dolce-gusto-machines", mention.phrase, sentence));
    }

    if (mentionsDolceGusto && !excludesNeo(sentence)) {
      for (const mention of matchesOf(NEO, sentence)) {
        problems.push(problem("dolce-gusto-neo", mention.phrase, sentence));
      }
    }

    const home = matchesOf(NESPRESSO_HOME_MACHINES, sentence);
    for (const mention of home) problems.push(problem("nespresso-home", mention.phrase, sentence));
    for (const mention of matchesOf(NESPRESSO_MACHINES, sentence)) {
      // Already reported as „домашни машини Nespresso“.
      if (home.some(({ index, end }) => mention.index < end && index < mention.end)) continue;
      const rest = sentence.slice(mention.end);
      if (NAMES_ORIGINAL.test(rest) || ABOUT_OTHER_NESPRESSO.test(rest)) continue;
      if (qualifiedBy(sentence, mention.index, "професионалн")) continue;
      if (qualifiedBy(sentence, mention.index, "класическ") && textNamesOriginal) continue;
      if (negated(sentence, mention.index, mention.end, false)) continue;
      problems.push(problem("nespresso-machines", mention.phrase, sentence));
    }

    if (!excludes(sentence, VERTUO)) {
      for (const mention of matchesOf(VERTUO, sentence)) {
        problems.push(problem("nespresso-vertuo", mention.phrase, sentence));
      }
    }

    if (!excludes(sentence, K_FEE)) {
      for (const mention of matchesOf(K_FEE, sentence)) {
        problems.push(problem("k-fee", mention.phrase, sentence));
      }
    }
  }

  const reported = (prefix: string) => problems.some(({ rule }) => rule.startsWith(prefix));

  if (!reported("dolce-gusto") && !textExcludesNeo) {
    for (const sentence of sentences) {
      const promise = fitPromise(sentence, DOLCE_GUSTO_NAME, [ABOUT_NEO]);
      if (!promise) continue;
      problems.push(problem("dolce-gusto-unqualified", promise.phrase, sentence));
      break;
    }
  }

  if (!reported("nespresso") && !textNamesOriginal) {
    for (const sentence of sentences) {
      const promise = fitPromise(sentence, NESPRESSO_NAME, [NAMES_ORIGINAL, ABOUT_OTHER_NESPRESSO]);
      if (!promise) continue;
      problems.push(problem("nespresso-unqualified", promise.phrase, sentence));
      break;
    }
  }

  if (!sentences.some(givesCafissimoCaveat)) {
    claims: for (const sentence of sentences) {
      for (const mention of matchesOf(CAFISSIMO, sentence)) {
        // Negated only: a Cafissimo is not "a system of its own" - it takes the format.
        if (negated(sentence, mention.index, mention.end, true)) continue;
        problems.push(problem("tchibo-cafissimo", mention.phrase, sentence));
        break claims;
      }
    }
  }

  return problems;
}
