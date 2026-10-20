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
 * HOW IT READS. Not with patterns over whole sentences — a negation three
 * clauses away, or a caveat that is really the claim again, satisfied those —
 * but the way a reader parses a promise: who governs each name.
 *
 *  - A sentence is read word by word. A fit word („съвместими“, „пасват“,
 *    „стават“, „подходящи“…) opens a run that affirms what follows; a negated
 *    one („не са съвместими“, „не стават“, „не NEO“, „без“, „освен“, „с
 *    изключение на“) opens a run that excludes it. A run carries across a list
 *    („не пасват на Nespresso, Dolce Gusto или K-fee“) and ends at the first
 *    word that is not part of one — a new verb („Не горчат и пасват на K-fee“:
 *    the negation was about bitterness), a contrast („но“, „а“), or the end of
 *    the clause („;“, „:“, a dash). „Не само“ affirms.
 *  - Each name then takes the run it stands in: affirmed, excluded, or — when
 *    no run reaches it — neutral. A neutral name may still be excluded by what
 *    its own clause goes on to say („NEO не ги приема“, „Vertuo приема само
 *    собствените си капсули“, „K-fee е отделна система“), and a capsule named
 *    by its system („хартиени дози NEO“, „капсулите на K-fee“) promises
 *    nothing about machines.
 *
 * WHAT IT ASKS OF EACH NAME.
 *
 *  1. A machine phrase that speaks for every machine of a name — „машини Dolce
 *     Gusto“, „всички модели Nespresso“, „всяка Dolce Gusto“ — carries the
 *     qualifier that leaves out the one that does not fit: NEO or Vertuo
 *     excluded in its own sentence, Original straight after Nespresso, or
 *     „класическите“ with that exclusion somewhere in the text. „Домашни
 *     машини Nespresso“ never passes: Vertuo is a home machine.
 *  2. NEO, Vertuo and K-fee are only ever named to be excluded.
 *  3. A Cafissimo — or a Tchibo machine — named as a fit needs Tchibo's own
 *     word somewhere in the text, as a statement of its own: Tchibo (or the
 *     machine's maker) says that only its own capsules should be used. „Работи
 *     само с капсули Caffitaly“ is the claim again, not the caveat.
 *  4. „Съвместими с Dolce Gusto“ or „с Nespresso“, without a machine word,
 *     needs NEO excluded (or Original named) somewhere in the text.
 *
 * WHAT IT LETS THROUGH, on purpose. A system's name on its own is not a promise
 * about machines: „Капсули за Dolce Gusto“ is what the product is, how the
 * shelf and the category are named, and how search spells it. Nor is the
 * reader's own machine in an instruction („Поставете капсулата в машината
 * Dolce Gusto“), nor a negative sentence („Капсула за Dolce Gusto не влиза в
 * машина Nespresso“ is true of every Nespresso).
 *
 * WHAT IT ASSUMES. That the shop sells no NEO pods, Vertuo capsules or K-fee
 * capsules — true of the catalogue, whose capsule formats are Dolce Gusto,
 * Nespresso (Original), Lavazza Blue, A Modo Mio and Caffitaly
 * (`product-name.ts`). Copy for such a product would have to name its own
 * machine, and these rules would first have to learn the product's system.
 */

/** Which promise a text broke. Stable: tests, logs and reports key on it. */
export type CompatibilityRule =
  /** „машини Dolce Gusto“ without NEO excluded. */
  | "dolce-gusto-machines"
  /** NEO named as a machine the capsules suit. */
  | "dolce-gusto-neo"
  /** A fit with Dolce Gusto promised, and NEO excluded nowhere in the text. */
  | "dolce-gusto-unqualified"
  /** „домашни(те) машини Nespresso“: Vertuo is a home machine too. */
  | "nespresso-home"
  /** „машини Nespresso“ without Original, or with Vertuo not excluded. */
  | "nespresso-machines"
  /** Vertuo named as a machine the capsules suit. */
  | "nespresso-vertuo"
  /** A fit with Nespresso promised, and Original named nowhere in the text. */
  | "nespresso-unqualified"
  /** K-fee named as a machine the capsules suit. */
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
 * cannot drift apart. The copywriter's originality audit does not count these
 * as shared phrasing: every product that states the fit must use them.
 */
export const COMPATIBILITY_WORDING = {
  dolceGusto: "съвместими с класическите машини Dolce Gusto (не NEO)",
  nespresso: "съвместими с класическите машини Nespresso (Original)",
  nespressoOriginal: "машини Nespresso Original",
  vertuo: "не с Vertuo",
  kFee: "K-fee е отделна система",
  cafissimo: "Tchibo посочва, че в Cafissimo трябва да се използват само нейните капсули",
} as const;

/* --- Text ------------------------------------------------------------------- */

/*
 * Written as character codes so the source shows what they are: stress marks
 * (the pronoun „ѝ“ is often typed as „и“ plus a grave accent), that pronoun as
 * one character, and the hyphens a word processor puts in „K‑fee“.
 */
const STRESS_MARKS = new RegExp(`[${String.fromCharCode(0x300, 0x301)}]`, "g");
const I_WITH_GRAVE = new RegExp(String.fromCharCode(0x45d), "g");
const HYPHENS = new RegExp(`[${String.fromCharCode(0x2010, 0x2011)}]`, "g");

function normalise(text: string): string {
  return text
    .normalize("NFC")
    .replace(I_WITH_GRAVE, "и")
    .replace(STRESS_MARKS, "")
    .replace(HYPHENS, "-");
}

/**
 * Sentences, as the rules read them: one per line, and a new one after `.`,
 * `!`, `?` or `…` where the next word starts like a sentence, so „16 бр. в
 * кутия“ stays whole.
 */
export function compatibilitySentences(text: string | readonly string[]): string[] {
  const fields = typeof text === "string" ? [text] : text;
  return fields
    .flatMap((field) => normalise(field).split(/\n+/))
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .flatMap((line) => line.split(/(?<=[.!?…])\s+(?=[„"«(\p{Lu}\p{N}])/u))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

interface Token {
  readonly raw: string;
  /** Lower-cased, without ®, ™ or a footnote star; a dash is „—“. */
  readonly w: string;
  readonly start: number;
  readonly end: number;
  readonly punct: boolean;
}

/** Words (with inner hyphens and apostrophes), and the punctuation that bounds a run. */
const TOKEN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’®™*-]*|[,;:()—–]|(?<=\s)-(?=\s)/gu;

function tokenize(sentence: string): Token[] {
  return [...sentence.matchAll(TOKEN)].map((match) => {
    const raw = match[0];
    const punct = !/^[\p{L}\p{N}]/u.test(raw);
    const w = punct
      ? raw === "–" || raw === "-"
        ? "—"
        : raw
      : raw
          .toLowerCase()
          .replace(/[®™*]+/g, "")
          .replace(/-+$/, "");
    return { raw, w, start: match.index, end: match.index + raw.length, punct };
  });
}

/* --- Words ------------------------------------------------------------------ */

type SystemName = "dolce-gusto" | "nespresso" | "neo" | "vertuo" | "k-fee" | "cafissimo" | "tchibo";

const NESCAFE = new Set(["nescafé", "nescafe", "нескафе"]);
const K_FEE = new Set(["k-fee", "kfee", "к-фий", "кфий", "к-фи"]);
/** Tchibo's lines that are not the Cafissimo: the Qbo pods, the Esperto bean-to-cup machines. */
const TCHIBO_OTHER_LINES = new Set(["qbo", "esperto"]);

const NEGATION = new Set(["не", "нито", "няма", "нямаме"]);
/** Words that may stand between a negation and the verb it negates. */
const NEGATION_FILLER = new Set([
  "са",
  "е",
  "се",
  "ги",
  "го",
  "ще",
  "могат",
  "може",
  "бива",
  "би",
  "биха",
  "и",
  "да",
  "я",
  "им",
  "също",
  "вече",
]);
/** „Без NEO“, „освен Vertuo“, „извън K-fee“. „С изключение на“ is read as one. */
const EXCLUDING = new Set(["без", "освен", "извън"]);
/** What follows a contrast is affirmed again: „не за Nespresso, а за K-fee“. */
const CONTRAST = new Set(["но", "а", "ала", "обаче", "ами"]);
const PREPOSITION = new Set(["с", "със", "за", "в", "във", "на", "от"]);
const QUANTIFIER = new Set([
  "всички",
  "всичките",
  "всяка",
  "всеки",
  "всяко",
  "всякакви",
  "всякаква",
  "всякакъв",
]);
/** „машини на Dolce Gusto“, „машините от системата Nespresso“. */
const LINK_NOUN = new Set(["системата", "марката", "линията", "серията"]);
/** Words a list of machines is made of, besides machines and names. */
const LIST_WORD = new Set(["и", "или", "както", "така", ...PREPOSITION, ...LINK_NOUN]);

const FIT =
  /^(?:съвместим|пасва|пасват|пасне|паснат|пасващ|влиза|влизат|влезе|влязат|влизащ|става|стават|стане|станат|работи|работят|подходящ|предназначен|годн|приема|приемат)/u;
const MACHINE = /^(?:кафе)?машин|^модел|^апарат/u;
const MACHINES = /^(?:(?:кафе)?машин(?:и|ите|ки|ките)|модели|моделите|апарати|апаратите)$/u;
const MODIFIER =
  /^(?:класическ|домашн|професионалн|нов|по-нов|стар|автоматичн|капсулн|оригинал|първ|втор|поколени)/u;
/** Tchibo, or a machine's maker, telling owners something. */
const SAYS =
  /^(?:посочва|посочи|препоръчва|препоръча|съветва|казва|изисква|предупреждава|настоява|заявява|уточнява|указва|напомня)/u;

const isWord = (token: Token | undefined): token is Token => token !== undefined && !token.punct;
const isMachine = (token: Token | undefined) => isWord(token) && MACHINE.test(token.w);
const isFit = (token: Token | undefined) => isWord(token) && FIT.test(token.w);
/** Latin words are brand and model names: „Original“, „Krups“, „Piccolo“. */
const isLatin = (token: Token) => /^[a-z0-9'’.&+-]+$/u.test(token.w);

function dolceGustoLength(tokens: readonly Token[], i: number): number {
  const w = tokens[i]?.w;
  const next = tokens[i + 1]?.w;
  if (w === "dolce-gusto" || w === "dolcegusto" || w === "долче-густо") return 1;
  if ((w === "dolce" && next === "gusto") || (w === "долче" && next === "густо")) return 2;
  return 0;
}

/** The system named at token `i`, and how many tokens its name takes. */
function nameAt(tokens: readonly Token[], i: number): { name: SystemName; length: number } | null {
  const token = tokens[i];
  if (!isWord(token)) return null;
  const w = token.w;
  if (NESCAFE.has(w)) {
    const length = dolceGustoLength(tokens, i + 1);
    return length ? { name: "dolce-gusto", length: length + 1 } : null;
  }
  const dolceGusto = dolceGustoLength(tokens, i);
  if (dolceGusto) return { name: "dolce-gusto", length: dolceGusto };
  if (w === "nespresso" || w === "неспресо") return { name: "nespresso", length: 1 };
  if (w === "neo" || w === "нео" || w.startsWith("neo-") || w.startsWith("нео-")) {
    return { name: "neo", length: 1 };
  }
  if (w.startsWith("vertuo") || w.startsWith("вертуо")) return { name: "vertuo", length: 1 };
  if (K_FEE.has(w)) return { name: "k-fee", length: 1 };
  if (w === "k" && tokens[i + 1]?.w === "fee") return { name: "k-fee", length: 2 };
  if (w === "cafissimo" || w === "кафисимо") return { name: "cafissimo", length: 1 };
  if (w === "tchibo" || w === "чибо") return { name: "tchibo", length: 1 };
  return null;
}

/** A word that can stand in a list of machines without ending the run. */
function continuesRun(tokens: readonly Token[], i: number): boolean {
  const token = tokens[i] as Token;
  if (token.punct) return token.w === "," || token.w === "(" || token.w === ")";
  return (
    LIST_WORD.has(token.w) ||
    QUANTIFIER.has(token.w) ||
    MACHINE.test(token.w) ||
    MODIFIER.test(token.w) ||
    isLatin(token)
  );
}

/* --- Reading a sentence ----------------------------------------------------- */

type Polarity = "affirm" | "negate" | "none";

interface Run {
  readonly polarity: Polarity;
  /** Where the fit word that opened an affirming run starts. */
  readonly fitAt: number | null;
  readonly id: number;
}

interface Mention {
  readonly name: SystemName;
  readonly first: number;
  readonly last: number;
  readonly run: Run;
}

interface MachineWord {
  readonly index: number;
  readonly run: Run;
}

const NO_RUN: Run = { polarity: "none", fitAt: null, id: 0 };

/** Which run governs every name and machine word in a sentence. */
function readRuns(tokens: readonly Token[]): { mentions: Mention[]; machines: MachineWord[] } {
  const mentions: Mention[] = [];
  const machines: MachineWord[] = [];
  const outer: Run[] = [];
  let run = NO_RUN;
  let runs = 0;
  const open = (polarity: Polarity, fitAt: number | null): Run => ({
    polarity,
    fitAt,
    id: (runs += 1),
  });

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as Token;
    if (token.punct) {
      if (token.w === "(") {
        // A parenthesis says its own thing: „(не NEO)“, „(NEO не е съвместима)“.
        outer.push(run);
        run = NO_RUN;
      } else if (token.w === ")") run = outer.pop() ?? NO_RUN;
      else if (token.w !== ",") {
        // „;“, „:“ and a dash end the clause, and whatever ran in it.
        run = NO_RUN;
        outer.length = 0;
      }
      continue;
    }

    const named = nameAt(tokens, i);
    if (named) {
      mentions.push({ name: named.name, first: i, last: i + named.length - 1, run });
      i += named.length - 1;
      continue;
    }

    const w = token.w;
    if (NEGATION.has(w)) {
      let j = i + 1;
      while (isWord(tokens[j]) && NEGATION_FILLER.has((tokens[j] as Token).w)) j += 1;
      const next = tokens[j];
      if (isWord(next) && (next.w === "само" || next.w === "единствено")) {
        // „Не само за Caffitaly“: not only - so also.
        if (run.polarity !== "affirm") run = open("affirm", null);
        i = j;
      } else if (isFit(next)) {
        run = open("negate", null);
        i = j;
      } else if (
        isWord(next) &&
        (PREPOSITION.has(next.w) ||
          QUANTIFIER.has(next.w) ||
          MACHINE.test(next.w) ||
          MODIFIER.test(next.w) ||
          nameAt(tokens, j) !== null)
      ) {
        // „не с Vertuo“, „(не NEO)“, „не за класическите…“
        run = open("negate", null);
        i = j - 1;
      } else {
        // A negated verb about something else („не горчат“, „не прави“).
        run = NO_RUN;
      }
      continue;
    }
    // „с изключение на K-fee“, „различни от Cafissimo“.
    if (
      (w === "с" && tokens[i + 1]?.w === "изключение") ||
      (w.startsWith("различн") && tokens[i + 1]?.w === "от")
    ) {
      run = open("negate", null);
      i += 1;
      continue;
    }
    if (EXCLUDING.has(w)) {
      run = open("negate", null);
      continue;
    }
    if (CONTRAST.has(w)) {
      run = NO_RUN;
      continue;
    }
    if (FIT.test(w)) {
      run = open("affirm", token.start);
      continue;
    }
    if (MACHINE.test(w)) {
      machines.push({ index: i, run });
      continue;
    }
    if (!continuesRun(tokens, i)) run = NO_RUN;
  }
  return { mentions, machines };
}

/* --- What a neutral name's own clause says --------------------------------- */

/** How far past a name its clause is read for what excludes it. */
const LOOKAHEAD_TOKENS = 30;

/** „не ги приема“, „няма да влязат“, „не е съвместима“, and what follows it. */
const FIT_DENIED =
  /(?<![\p{L}\p{N}])(?:не|нито|няма\s+да)\s+(?:(?:са|е|се|ги|го|ще|могат|може|бива|би|биха|и|да|я|им|също|вече)\s+){0,3}(?:съвместим|пас|влиз|влез|вляз|став|стан|работ|прием|подходящ|предназначен|годн)\p{L}*([^,.;:]*)/giu;
/** „За моделите NEO не са.“ */
const DENIED_AT_END = /(?<![\p{L}\p{N}])не\s+(?:са|е)\s*(?:[,.;:)]|$)/iu;
/** „Vertuo приема само собствените си капсули“, „NEO работи с хартиени дози“. */
const TAKES_ITS_OWN =
  /(?<![\p{L}\p{N}])(?:приема|приемат|работи|работят|използва|използват|ползва|ползват)\s+(?:(?:само|единствено|с|със)\s+){0,2}(?:собствен|сво[иья]|нейн|негов|друг|хартиен|капсулите\s+на|капсули\s+(?:vertuo|neo|k-fee|tchibo))/iu;
/** „K-fee е отделна система“, „…са други системи“, „— собствена система“; not „със собствена система за налягане“. */
const SYSTEM_APART =
  /(?:(?<![\p{L}\p{N}])(?:е|са)|[—–,(]|\s-)\s*(?:(?:една|по|също|изцяло)\s+)?(?:отделн|самостоятелн|собствен|друг|несъвместим)\p{L}*\s+(?:[\p{L}-]+\s+)?(?:систем|формат)/iu;
/** „…няколко несъвместими системи: Dolce Gusto и Dolce Gusto NEO, Nespresso Original и Vertuo“. */
const SYSTEMS_LISTED = /(?:несъвместим|различн|отделн|друг)\p{L}*\s+систем\p{L}*\s*:$/iu;

/**
 * The rest of a name's clause: through commas and dashes, up to „;“ or „:“,
 * and — with `contrast` false — up to a contrast as well. A denial after
 * „но“ is about something else („K-fee, но не Nespresso“); what the name is
 * („Vertuo носи името Nespresso, но е отделна система“) is not.
 */
function clauseAfter(
  sentence: string,
  tokens: readonly Token[],
  last: number,
  contrast: boolean,
): string {
  const from = (tokens[last] as Token).end;
  let to = from;
  for (let k = last + 1; k < tokens.length && k <= last + LOOKAHEAD_TOKENS; k += 1) {
    const token = tokens[k] as Token;
    if (token.punct ? token.w === ";" || token.w === ":" : !contrast && CONTRAST.has(token.w)) {
      break;
    }
    to = token.end;
  }
  return sentence.slice(from, to);
}

/** Whether the rest of a sentence names a system other than `name`. */
function namesAnother(text: string, name: SystemName): boolean {
  const tokens = tokenize(text);
  return tokens.some((_, i) => {
    const other = nameAt(tokens, i);
    return other !== null && other.name !== name;
  });
}

/** Whether what follows a neutral name excludes it. */
function excludedByItsClause(sentence: string, tokens: readonly Token[], m: Mention): boolean {
  const after = clauseAfter(sentence, tokens, m.last, false);
  for (const denial of after.matchAll(FIT_DENIED)) {
    // „K-fee, които не пасват на Nespresso“: the denial is about Nespresso.
    if (!namesAnother(denial[1] ?? "", m.name)) return true;
  }
  if (DENIED_AT_END.test(after)) return true;
  const whole = clauseAfter(sentence, tokens, m.last, true);
  if (TAKES_ITS_OWN.test(whole) || SYSTEM_APART.test(whole)) return true;
  const before = sentence.slice(0, (tokens[m.first] as Token).start);
  const clauseStart = before.lastIndexOf(";") + 1;
  const colon = before.lastIndexOf(":");
  return colon >= clauseStart && SYSTEMS_LISTED.test(before.slice(clauseStart, colon + 1));
}

/** „капсули Vertuo“, „хартиени дози NEO“, „капсулите на K-fee“: a capsule, not a machine. */
function namesACapsule(tokens: readonly Token[], m: Mention): boolean {
  const capsule = (token: Token | undefined) => isWord(token) && /^(?:капсул|доз)/u.test(token.w);
  const before = tokens[m.first - 1];
  return capsule(before) || (before?.w === "на" && capsule(tokens[m.first - 2]));
}

/* --- Machine phrases ------------------------------------------------------- */

interface Phrase {
  /** The first token of the phrase: a quantifier, a modifier or the machine word. */
  readonly first: number;
  /** The machine word, if any. */
  readonly machine: number | null;
  /** Speaks for every machine of the name: plural or quantified. */
  readonly every: boolean;
  readonly classic: boolean;
  readonly home: boolean;
  readonly professional: boolean;
}

/** Modifiers before token `from`, back to the first word that is not one. */
function modifiersBefore(tokens: readonly Token[], from: number): number {
  let first = from + 1;
  for (let k = from; k >= 0 && k > from - 3; k -= 1) {
    const token = tokens[k];
    if (!isWord(token) || !(QUANTIFIER.has(token.w) || MODIFIER.test(token.w))) break;
    first = k;
  }
  return first;
}

/** The phrase whose words run from `first` to `last`, with its machine word, if any. */
function describePhrase(
  tokens: readonly Token[],
  first: number,
  last: number,
  machine: number | null,
): Phrase {
  const words = tokens.slice(first, last + 1).map((token) => token.w);
  return {
    first,
    machine,
    every:
      words.some((w) => QUANTIFIER.has(w)) ||
      (machine !== null && MACHINES.test((tokens[machine] as Token).w)),
    classic: words.some((w) => w.startsWith("класическ")),
    home: words.some((w) => w.startsWith("домашн")),
    professional: words.some((w) => w.startsWith("професионалн")),
  };
}

/** The machine phrase around a system's name: „класическите машини Dolce Gusto“. */
function phraseOf(tokens: readonly Token[], m: Mention): Phrase {
  let k = m.first - 1;
  if (LINK_NOUN.has(tokens[k]?.w ?? "")) k -= 1;
  if (["на", "от", "за"].includes(tokens[k]?.w ?? "")) k -= 1;
  if (isMachine(tokens[k])) return describePhrase(tokens, modifiersBefore(tokens, k - 1), k, k);
  // „Dolce Gusto машини“, „всяка Dolce Gusto“.
  const after = isMachine(tokens[m.last + 1]) ? m.last + 1 : null;
  return describePhrase(tokens, modifiersBefore(tokens, m.first - 1), m.first - 1, after);
}

/* --- Tchibo's caveat ------------------------------------------------------- */

const OWN_CAPSULES_SOURCE =
  "(?:(?:нейн|собствен|сво|негов|оригинал)\\p{L}*(?:\\s+(?:си|и|й))?(?:\\s+[\\p{L}\\p{N}-]+){0,2}\\s+капсул|капсул\\p{L}*\\s+(?:на\\s+)?(?:tchibo|чибо|марката|производителя))";
const OWN_CAPSULES = new RegExp(`(?<![\\p{L}\\p{N}])${OWN_CAPSULES_SOURCE}`, "u");
const OWN_CAPSULES_NEXT = new RegExp(`^(?:(?:с|със)\\s+)?${OWN_CAPSULES_SOURCE}`, "u");
const ONLY = /(?<![\p{L}\p{N}])(?:само|единствено)\s+/gu;
const WARRANTY = /гаранци/u;
/** Lost or not covered — not „не губите гаранцията“. */
const WARRANTY_DENIED =
  /(?<![\p{L}\p{N}])не\s+(?:се\s+)?(?:поема|поеме|покрива|покрие|важи|признава|признае)|(?<!не\s)(?<![\p{L}\p{N}])(?:губи|загуб|отпада|отпадне|анулир|отказ)\p{L}*/u;

/**
 * Whether a sentence gives Tchibo's word on the Cafissimo, as a statement of
 * its own: Tchibo the company (or the machine's maker) says — „посочва“,
 * „препоръчва“, „съветва“… — that only its own capsules should be used.
 * „Само“ there must govern those capsules: „Tchibo Cafissimo работи само с
 * капсули Caffitaly“ is the claim again, and „Tchibo предлага само капсули за
 * Cafissimo и Qbo“ says nothing of the kind. The warranty counts only as lost
 * or not covered („не поема“, „може да не покрие“) — „не губите гаранцията“
 * is the opposite.
 */
function givesTchibosWord(sentence: string, tokens: readonly Token[]): boolean {
  const company = tokens.some(
    (token, i) =>
      (token.w === "tchibo" || token.w === "чибо") &&
      !isMachine(tokens[i - 1]) &&
      !isMachine(tokens[i + 1]) &&
      !["cafissimo", "кафисимо", ...TCHIBO_OTHER_LINES].includes(tokens[i + 1]?.w ?? ""),
  );
  const maker = tokens.some((token) => token.w.startsWith("производител"));
  if (!company && !maker) return false;
  const lower = sentence.toLowerCase();
  // „Tchibo не поема по гаранция ремонт след чужди капсули“: its own word, as an act.
  if (WARRANTY.test(lower) && WARRANTY_DENIED.test(lower)) return true;
  const says =
    tokens.some((token, i) => SAYS.test(token.w) && !NEGATION.has(tokens[i - 1]?.w ?? "")) ||
    /(?<![\p{L}\p{N}])(?:по думите на|според)\s/iu.test(sentence);
  if (!says || !OWN_CAPSULES.test(lower)) return false;
  const onlies = [...lower.matchAll(ONLY)];
  return (
    onlies.length === 0 ||
    onlies.some((only) => OWN_CAPSULES_NEXT.test(lower.slice(only.index + only[0].length)))
  );
}

/* --- The rules ------------------------------------------------------------- */

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

interface ReadSentence {
  readonly text: string;
  readonly tokens: readonly Token[];
  readonly mentions: readonly Mention[];
  readonly machines: readonly MachineWord[];
  /** NEO, and Vertuo, excluded here rather than merely named (a capsule of it does not count). */
  readonly excludesNeo: boolean;
  readonly excludesVertuo: boolean;
}

function readSentence(text: string): ReadSentence {
  const tokens = tokenize(text);
  const { mentions, machines } = readRuns(tokens);
  const excludes = (name: SystemName) =>
    mentions.some(
      (m) =>
        m.name === name &&
        (m.run.polarity === "negate" ||
          (m.run.polarity === "none" && excludedByItsClause(text, tokens, m))),
    );
  return {
    text,
    tokens,
    mentions,
    machines,
    excludesNeo: excludes("neo"),
    excludesVertuo: excludes("vertuo"),
  };
}

/** The system a name refers to: „Dolce Gusto NEO“ is NEO, „Nespresso Vertuo“ is Vertuo. */
function refersToOther(sentence: ReadSentence, m: Mention): boolean {
  const next = sentence.tokens[m.last + 1];
  if (!isWord(next)) return false;
  if (m.name === "dolce-gusto") return nameAt(sentence.tokens, m.last + 1)?.name === "neo";
  return /^(?:vertuo|вертуо|professional)|^pro$/u.test(next.w);
}

/** „Nespresso Original“, „(Original)“, „(системата Original)“, „от линията Original“. */
function originalAfter(tokens: readonly Token[], m: Mention): boolean {
  let k = m.last + 1;
  if (tokens[k]?.w === "(") k += 1;
  if (tokens[k]?.w === "от") k += 1;
  if (LINK_NOUN.has(tokens[k]?.w ?? "") || tokens[k]?.w === "line") k += 1;
  const w = tokens[k]?.w ?? "";
  return w.startsWith("original") || w.startsWith("оригинал");
}

/**
 * Every broken compatibility promise in one product's text — its summary and
 * body paragraphs together, as the page shows them. An empty list is copy that
 * may be published.
 *
 * Every name that breaks a rule is reported. The rules over the whole text
 * (an unqualified „съвместими с Dolce Gusto“, a Cafissimo without Tchibo's
 * word) report their first promise, and the first only when no sentence about
 * the same system was reported already: one fix answers both.
 */
export function compatibilityProblems(text: string | readonly string[]): CompatibilityProblem[] {
  const sentences = compatibilitySentences(text).map(readSentence);
  const all = sentences.flatMap((sentence) => sentence.mentions.map((m) => ({ sentence, m })));
  const mentionsDolceGusto = all.some(({ m }) => m.name === "dolce-gusto");
  const textExcludesNeo = sentences.some((sentence) => sentence.excludesNeo);
  const textExcludesVertuo = sentences.some((sentence) => sentence.excludesVertuo);
  const textNamesOriginal = all.some(
    ({ sentence, m }) =>
      m.name === "nespresso" && m.run.polarity !== "negate" && originalAfter(sentence.tokens, m),
  );
  const problems: CompatibilityProblem[] = [];
  const unqualified: Array<{ rule: CompatibilityRule; phrase: string; sentence: string }> = [];
  const claims: Array<{ phrase: string; sentence: string }> = [];

  for (const sentence of sentences) {
    const { text: s, tokens } = sentence;
    const slice = (first: number, last: number) =>
      s.slice((tokens[first] as Token).start, (tokens[last] as Token).end);
    const neutralExcluded = (m: Mention) =>
      m.run.polarity === "none" && excludedByItsClause(s, tokens, m);
    const inPhrase = new Set<number>();

    for (const m of sentence.mentions) {
      if (m.name === "neo" || m.name === "vertuo" || m.name === "k-fee") {
        if (m.name === "neo" && !mentionsDolceGusto) continue;
        if (m.run.polarity === "negate") continue;
        if (m.run.polarity === "none" && (namesACapsule(tokens, m) || neutralExcluded(m))) continue;
        const rule =
          m.name === "neo" ? "dolce-gusto-neo" : m.name === "vertuo" ? "nespresso-vertuo" : "k-fee";
        problems.push(problem(rule, slice(m.first, m.last), s));
        continue;
      }

      if (m.name === "cafissimo" || m.name === "tchibo") {
        if (m.name === "tchibo") {
          const next = tokens[m.last + 1]?.w ?? "";
          if (next === "cafissimo" || next === "кафисимо" || TCHIBO_OTHER_LINES.has(next)) continue;
          const machine = isMachine(tokens[m.first - 1]) || isMachine(tokens[m.last + 1]);
          // Tchibo the company („Tchibo посочва…“, „капсули на Tchibo“) promises no fit.
          if (!machine && !(m.run.polarity === "affirm" && m.run.fitAt !== null)) continue;
        }
        if (m.run.polarity === "negate" || neutralExcluded(m)) continue;
        claims.push({ phrase: slice(m.first, m.last), sentence: s });
        continue;
      }

      // Dolce Gusto and Nespresso.
      if (refersToOther(sentence, m)) continue;
      const dolceGusto = m.name === "dolce-gusto";
      const phrase = phraseOf(tokens, m);
      if (phrase.machine !== null) inPhrase.add(phrase.machine);
      if (m.run.polarity === "negate" || neutralExcluded(m)) continue;
      const words = slice(phrase.first, Math.max(m.last, phrase.machine ?? m.last));

      if (phrase.every) {
        if (dolceGusto) {
          if (sentence.excludesNeo || (phrase.classic && textExcludesNeo)) continue;
          problems.push(problem("dolce-gusto-machines", words, s));
        } else {
          if (phrase.professional) continue;
          if (phrase.home) {
            problems.push(problem("nespresso-home", words, s));
            continue;
          }
          if (originalAfter(tokens, m) || sentence.excludesVertuo) continue;
          if (phrase.classic && (textNamesOriginal || textExcludesVertuo)) continue;
          problems.push(problem("nespresso-machines", words, s));
        }
        continue;
      }

      // The system's name, or the reader's own machine: a promise only after a fit word.
      if (m.run.polarity !== "affirm" || m.run.fitAt === null) continue;
      if (dolceGusto ? textExcludesNeo : textNamesOriginal || textExcludesVertuo) continue;
      if (!dolceGusto && originalAfter(tokens, m)) continue;
      unqualified.push({
        rule: dolceGusto ? "dolce-gusto-unqualified" : "nespresso-unqualified",
        phrase: s.slice(m.run.fitAt, (tokens[m.last] as Token).end),
        sentence: s,
      });
    }

    // „…класическите машини Dolce Gusto и новите модели“: the list's other machines.
    for (const machine of sentence.machines) {
      if (inPhrase.has(machine.index) || machine.run.polarity !== "affirm") continue;
      const owner = sentence.mentions.find(
        (m) =>
          m.run.id === machine.run.id &&
          m.last < machine.index &&
          (m.name === "dolce-gusto" || m.name === "nespresso") &&
          !refersToOther(sentence, m),
      );
      if (!owner) continue;
      const phrase = describePhrase(
        tokens,
        modifiersBefore(tokens, machine.index - 1),
        machine.index,
        machine.index,
      );
      if (!phrase.every) continue;
      const words = slice(phrase.first, machine.index);
      if (owner.name === "dolce-gusto") {
        if (sentence.excludesNeo || (phrase.classic && textExcludesNeo)) continue;
        problems.push(problem("dolce-gusto-machines", words, s));
      } else {
        if (sentence.excludesVertuo) continue;
        if (phrase.classic && (textNamesOriginal || textExcludesVertuo)) continue;
        problems.push(problem(phrase.home ? "nespresso-home" : "nespresso-machines", words, s));
      }
    }
  }

  const reported = (prefix: string) => problems.some(({ rule }) => rule.startsWith(prefix));
  for (const rule of ["dolce-gusto-unqualified", "nespresso-unqualified"] as const) {
    const first = unqualified.find((entry) => entry.rule === rule);
    if (first && !reported(rule.split("-unqualified")[0] as string)) {
      problems.push(problem(rule, first.phrase, first.sentence));
    }
  }

  const caveat = sentences.some((sentence) => givesTchibosWord(sentence.text, sentence.tokens));
  const claim = claims[0];
  if (claim && !caveat) problems.push(problem("tchibo-cafissimo", claim.phrase, claim.sentence));

  return problems;
}
