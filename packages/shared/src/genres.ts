export const CANONICAL_GENRES = [
  "action",
  "adventure",
  "animation",
  "comedy",
  "crime",
  "documentary",
  "drama",
  "family",
  "fantasy",
  "history",
  "horror",
  "music",
  "mystery",
  "romance",
  "science-fiction",
  "thriller",
  "war",
  "western",
  "sports",
  "supernatural",
] as const;

export type CanonicalGenre = (typeof CANONICAL_GENRES)[number];

const GENRE_ALIASES: Record<string, CanonicalGenre> = {
  acao: "action",
  action: "action",
  aventura: "adventure",
  adventure: "adventure",
  animacao: "animation",
  animation: "animation",
  anime: "animation",
  comedia: "comedy",
  comedy: "comedy",
  crime: "crime",
  criminal: "crime",
  documentario: "documentary",
  documentary: "documentary",
  drama: "drama",
  familia: "family",
  family: "family",
  fantasia: "fantasy",
  fantasy: "fantasy",
  historia: "history",
  history: "history",
  terror: "horror",
  horror: "horror",
  musica: "music",
  music: "music",
  misterio: "mystery",
  mystery: "mystery",
  romance: "romance",
  ficcao_cientifica: "science-fiction",
  science_fiction: "science-fiction",
  scifi: "science-fiction",
  suspense: "thriller",
  thriller: "thriller",
  guerra: "war",
  war: "war",
  western: "western",
  esporte: "sports",
  sports: "sports",
  sobrenatural: "supernatural",
  supernatural: "supernatural",
  accion: "action", animacion: "animation", crimen: "crime", documental: "documentary",
  ciencia_ficcion: "science-fiction", deportes: "sports",
  aventure: "adventure", comedie: "comedy", documentaire: "documentary", famille: "family",
  fantastique: "fantasy", histoire: "history", horreur: "horror", mystere: "mystery",
  guerre: "war", sport: "sports", surnaturel: "supernatural",
  abenteuer: "adventure", komodie: "comedy", krimi: "crime", dokumentarfilm: "documentary",
  familie: "family", geschichte: "history", romantik: "romance", krieg: "war",
  musik: "music", ubernaturlich: "supernatural",
  azione: "action", avventura: "adventure", animazione: "animation", commedia: "comedy",
  crimine: "crime", famiglia: "family", storia: "history",
  mistero: "mystery", romantico: "romance", fantascienza: "science-fiction", soprannaturale: "supernatural",
  sf: "science-fiction",
  アクション: "action", アドベンチャー: "adventure", アニメーション: "animation",
  コメディ: "comedy", 犯罪: "crime", ドキュメンタリー: "documentary", ドラマ: "drama",
  ファミリー: "family", ファンタジー: "fantasy", 歴史: "history", ホラー: "horror",
  音楽: "music", ミステリー: "mystery", ロマンス: "romance", サイエンスフィクション: "science-fiction",
  スリラー: "thriller", 戦争: "war", 西部劇: "western", スポーツ: "sports", 超自然: "supernatural",
  액션: "action", 모험: "adventure", 애니메이션: "animation", 코미디: "comedy", 범죄: "crime",
  다큐멘터리: "documentary", 드라마: "drama", 가족: "family", 판타지: "fantasy", 역사: "history",
  공포: "horror", 음악: "music", 미스터리: "mystery", 로맨스: "romance", 공상과학: "science-fiction",
  스릴러: "thriller", 전쟁: "war", 서부극: "western", 스포츠: "sports", 초자연: "supernatural",
  动作: "action", 冒险: "adventure", 动画: "animation", 喜剧: "comedy", 犯罪片: "crime",
  纪录片: "documentary", 剧情: "drama", 家庭: "family", 奇幻: "fantasy", 历史片: "history",
  恐怖: "horror", 音乐片: "music", 悬疑: "mystery", 爱情: "romance", 科幻: "science-fiction",
  惊悚: "thriller", 战争片: "war", 西部片: "western", 体育: "sports",
};

const LABELS: Record<string, Partial<Record<CanonicalGenre, string>>> = {
  en: {
    action: "Action", adventure: "Adventure", animation: "Animation",
    comedy: "Comedy", crime: "Crime", documentary: "Documentary", drama: "Drama",
    family: "Family", fantasy: "Fantasy", history: "History", horror: "Horror",
    music: "Music", mystery: "Mystery", romance: "Romance",
    "science-fiction": "Science fiction", thriller: "Thriller", war: "War",
    western: "Western", sports: "Sports", supernatural: "Supernatural",
  },
  pt: {
    action: "Ação", adventure: "Aventura", animation: "Animação",
    comedy: "Comédia", crime: "Crime", documentary: "Documentário", drama: "Drama",
    family: "Família", fantasy: "Fantasia", history: "História", horror: "Terror",
    music: "Música", mystery: "Mistério", romance: "Romance",
    "science-fiction": "Ficção científica", thriller: "Suspense", war: "Guerra",
    western: "Faroeste", sports: "Esportes", supernatural: "Sobrenatural",
  },
  es: {
    action: "Acción", adventure: "Aventura", animation: "Animación", comedy: "Comedia",
    crime: "Crimen", documentary: "Documental", drama: "Drama", family: "Familia",
    fantasy: "Fantasía", history: "Historia", horror: "Terror", music: "Música",
    mystery: "Misterio", romance: "Romance", "science-fiction": "Ciencia ficción",
    thriller: "Suspenso", war: "Guerra", western: "Wéstern", sports: "Deportes", supernatural: "Sobrenatural",
  },
  fr: {
    action: "Action", adventure: "Aventure", animation: "Animation", comedy: "Comédie",
    crime: "Crime", documentary: "Documentaire", drama: "Drame", family: "Famille",
    fantasy: "Fantastique", history: "Histoire", horror: "Horreur", music: "Musique",
    mystery: "Mystère", romance: "Romance", "science-fiction": "Science-fiction",
    thriller: "Thriller", war: "Guerre", western: "Western", sports: "Sport", supernatural: "Surnaturel",
  },
  de: {
    action: "Action", adventure: "Abenteuer", animation: "Animation", comedy: "Komödie",
    crime: "Krimi", documentary: "Dokumentarfilm", drama: "Drama", family: "Familie",
    fantasy: "Fantasy", history: "Geschichte", horror: "Horror", music: "Musik",
    mystery: "Mystery", romance: "Romantik", "science-fiction": "Science-Fiction",
    thriller: "Thriller", war: "Krieg", western: "Western", sports: "Sport", supernatural: "Übernatürlich",
  },
  it: {
    action: "Azione", adventure: "Avventura", animation: "Animazione", comedy: "Commedia",
    crime: "Crimine", documentary: "Documentario", drama: "Dramma", family: "Famiglia",
    fantasy: "Fantasy", history: "Storia", horror: "Horror", music: "Musica",
    mystery: "Mistero", romance: "Romantico", "science-fiction": "Fantascienza",
    thriller: "Thriller", war: "Guerra", western: "Western", sports: "Sport", supernatural: "Soprannaturale",
  },
  ja: {
    action: "アクション", adventure: "アドベンチャー", animation: "アニメーション", comedy: "コメディ",
    crime: "犯罪", documentary: "ドキュメンタリー", drama: "ドラマ", family: "ファミリー",
    fantasy: "ファンタジー", history: "歴史", horror: "ホラー", music: "音楽", mystery: "ミステリー",
    romance: "ロマンス", "science-fiction": "SF", thriller: "スリラー", war: "戦争",
    western: "西部劇", sports: "スポーツ", supernatural: "超自然",
  },
  ko: {
    action: "액션", adventure: "모험", animation: "애니메이션", comedy: "코미디", crime: "범죄",
    documentary: "다큐멘터리", drama: "드라마", family: "가족", fantasy: "판타지", history: "역사",
    horror: "공포", music: "음악", mystery: "미스터리", romance: "로맨스", "science-fiction": "SF",
    thriller: "스릴러", war: "전쟁", western: "서부극", sports: "스포츠", supernatural: "초자연",
  },
  zh: {
    action: "动作", adventure: "冒险", animation: "动画", comedy: "喜剧", crime: "犯罪",
    documentary: "纪录片", drama: "剧情", family: "家庭", fantasy: "奇幻", history: "历史",
    horror: "恐怖", music: "音乐", mystery: "悬疑", romance: "爱情", "science-fiction": "科幻",
    thriller: "惊悚", war: "战争", western: "西部", sports: "体育", supernatural: "超自然",
  },
};

function genreKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_|_$/g, "");
}

export function canonicalizeGenre(value: string): CanonicalGenre | null {
  return GENRE_ALIASES[genreKey(value)] ?? null;
}

export function canonicalizeGenres(values?: readonly string[]): CanonicalGenre[] {
  if (!values) return [];
  return [...new Set(values.map(canonicalizeGenre).filter((value): value is CanonicalGenre => value != null))];
}

export function genreLabel(genre: CanonicalGenre, locale = "en"): string {
  const language = locale.split("-")[0]?.toLowerCase() ?? "en";
  return LABELS[language]?.[genre] ?? LABELS.en?.[genre] ?? genre;
}

/** OR semantics: one matching requested genre is enough. */
export function matchesAnyGenre(
  itemGenres: readonly string[] | undefined,
  requestedGenres: readonly string[],
): boolean {
  if (requestedGenres.length === 0) return true;
  const wanted = new Set(canonicalizeGenres(requestedGenres));
  if (wanted.size === 0) return false;
  return canonicalizeGenres(itemGenres).some((genre) => wanted.has(genre));
}
