const TVMAZE_BASE = "https://api.tvmaze.com";

interface TVMazeShow {
  id: number;
  name: string;
  summary?: string;
  image?: { medium?: string; original?: string };
  premiered?: string;
  rating?: { average?: number };
  genres?: string[];
  status?: string;
  runtime?: number;
  externals?: { imdb?: string; thetvdb?: number };
}

interface TVMazeEpisode {
  id: number;
  name: string;
  season: number;
  number: number;
  airdate?: string;
  runtime?: number;
  summary?: string;
  image?: { medium?: string; original?: string };
}

interface TVMazePerson {
  id: number;
  name: string;
  url?: string;
  birthday?: string | null;
  deathday?: string | null;
  gender?: string | null;
  image?: { medium?: string; original?: string };
  country?: { name: string; code: string };
}

interface TVMazeCastEntry {
  person: {
    id: number;
    name: string;
    image?: { medium?: string; original?: string };
  };
  character?: { name: string };
}

interface TVMazePersonCredit {
  _embedded?: {
    castcredits?: Array<{
      _links?: { show?: { href?: string; name?: string } };
      character?: { name: string };
    }>;
  };
}

async function fetchTVMaze<T>(path: string): Promise<T> {
  const res = await fetch(`${TVMAZE_BASE}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`TVMaze error: ${res.status} ${path}`);
  }
  return res.json() as Promise<T>;
}

export async function searchTVMaze(query: string) {
  const data = await fetchTVMaze<Array<{ show: TVMazeShow; score: number }>>(
    `/search/shows?q=${encodeURIComponent(query)}`,
  );
  return data.map((r) => r.show);
}

export async function getTVMazeShow(id: number) {
  return fetchTVMaze<TVMazeShow>(`/shows/${id}`);
}

export async function getTVMazeEpisodes(showId: number) {
  return fetchTVMaze<TVMazeEpisode[]>(`/shows/${showId}/episodes`);
}

export async function getTVMazeShowByImdb(imdbId: string) {
  const data = await fetchTVMaze<TVMazeShow>(
    `/lookup/shows?imdb=${imdbId}`,
  );
  return data;
}

export async function getTVMazePerson(id: number) {
  return fetchTVMaze<TVMazePerson>(`/people/${id}`);
}

export async function searchTVMazePeople(query: string) {
  const data = await fetchTVMaze<Array<{ person: TVMazePerson; score: number }>>(
    `/search/people?q=${encodeURIComponent(query)}`,
  );
  return data.map((r) => r.person);
}

export async function getTVMazeShowCast(showId: number) {
  const data = await fetchTVMaze<{ _embedded?: { cast?: TVMazeCastEntry[] } }>(
    `/shows/${showId}?embed=cast`,
  );
  return data._embedded?.cast ?? [];
}

export async function getTVMazePersonCredits(personId: number) {
  const data = await fetchTVMaze<TVMazePersonCredit>(
    `/people/${personId}?embed=castcredits`,
  );
  return data._embedded?.castcredits ?? [];
}

export function mapTVMazePerson(person: TVMazePerson) {
  return {
    id: person.id,
    name: person.name,
    birthday: person.birthday ?? undefined,
    deathday: person.deathday ?? undefined,
    gender: person.gender ?? undefined,
    image: person.image?.medium ?? person.image?.original,
    country: person.country?.name,
  };
}

export function mapTVMazeToItem(show: TVMazeShow) {
  return {
    id: show.externals?.imdb ?? String(show.id),
    type: "series" as const,
    title: show.name,
    description: show.summary?.replace(/<[^>]+>/g, "") ?? undefined,
    poster: show.image?.medium,
    backdrop: show.image?.original,
    year: show.premiered ? Number(show.premiered.slice(0, 4)) : undefined,
    rating: show.rating?.average,
    genres: show.genres,
    externalIds: {
      imdb: show.externals?.imdb,
      tvmaze: show.id,
    },
    _adultCheck: {
      genres: show.genres,
      title: show.name,
    },
    _raw: show,
  };
}

export function mapTVMazeEpisode(ep: TVMazeEpisode) {
  return {
    id: String(ep.id),
    number: ep.number,
    season: ep.season,
    title: ep.name,
    description: ep.summary?.replace(/<[^>]+>/g, "") ?? undefined,
    airDate: ep.airdate,
    runtime: ep.runtime,
    still: ep.image?.medium,
  };
}
