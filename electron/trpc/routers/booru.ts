import * as z from "zod";
import { publicProcedure, router } from "../trpc";
import { isLikelyVideoUrl } from "../../../src/constants/videoFormats";

const ZBooruSource = z.enum(["rule34", "gelbooru", "danbooru"]);

const ZBooruMediaItem = z.object({
  id: z.string(),
  source: ZBooruSource,
  url: z.string().min(1),
  previewUrl: z.string().min(1).nullable().optional(),
});

type BooruMediaItem = z.infer<typeof ZBooruMediaItem>;
type DanbooruMediaItem = Omit<BooruMediaItem, "source"> & { source: "danbooru" };

function toTags(prompt: string): string {
  return prompt
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(" ");
}

function toTagQuery(prompt: string): string {
  return toTags(prompt);
}

function isSupportedMediaUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return isLikelyVideoUrl(url) || /\.(gif|png|jpe?g)$/i.test(url);
}

function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "f-land/0.1 (+electron)",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch (error) {
    console.warn("Booru JSON fetch failed", url, error);
    return null;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "f-land/0.1 (+electron)",
        Accept: "application/xml,text/xml,text/plain,*/*",
      },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch (error) {
    console.warn("Booru text fetch failed", url, error);
    return null;
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseXmlPosts(
  xml: string,
  source: "rule34" | "gelbooru",
): BooruMediaItem[] {
  const posts: BooruMediaItem[] = [];
  const postRegex = /<post\b([^>]*)\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = postRegex.exec(xml)) !== null) {
    const rawAttrs = match[1] ?? "";
    const attrs: Record<string, string> = {};
    const attrRegex = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
      const key = attrMatch[1];
      const value = attrMatch[2];
      if (!key || typeof value !== "string") continue;
      attrs[key] = decodeXmlEntities(value);
    }

    const media = normalizeUrl(attrs.file_url ?? attrs.sample_url);
    if (!isSupportedMediaUrl(media)) continue;
    const id = attrs.id ?? media;
    posts.push({
      id: `${source}-${id}`,
      source,
      url: media,
      previewUrl: normalizeUrl(attrs.sample_url) ?? null,
    });
  }

  return posts;
}

async function fetchRule34(tags: string, limit: number): Promise<BooruMediaItem[]> {
  const url = `https://rule34.xxx/index.php?page=dapi&s=post&q=index&limit=${limit}&tags=${encodeURIComponent(tags)}`;
  const xml = await fetchText(url);
  if (!xml) return [];
  if (xml.includes("Missing authentication")) return [];
  return parseXmlPosts(xml, "rule34");
}

function extractRule34PostIds(listHtml: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const idRegex = /href="\/index\.php\?page=post&s=view&id=(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = idRegex.exec(listHtml)) !== null) {
    const id = match[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function extractRule34ThumbById(listHtml: string): Map<string, string> {
  const thumbById = new Map<string, string>();
  const thumbRegex = /<img\s+src="([^"]+thumbnail_[^"?]+\.\w+)\?(\d+)"/g;
  let match: RegExpExecArray | null;
  while ((match = thumbRegex.exec(listHtml)) !== null) {
    const thumb = normalizeUrl(match[1]);
    const id = match[2];
    if (!thumb || !id) continue;
    if (!thumbById.has(id)) thumbById.set(id, thumb);
  }
  return thumbById;
}

function buildRule34FullCandidates(thumbUrl: string, postId: string): string[] {
  const normalized = normalizeUrl(thumbUrl);
  if (!normalized) return [];

  const parsed = (() => {
    try {
      return new URL(normalized);
    } catch {
      return null;
    }
  })();
  if (!parsed) return [];

  // /thumbnails/{bucket}/thumbnail_{hash}.{ext}
  const match = parsed.pathname.match(/^\/thumbnails\/([^/]+)\/thumbnail_([^/.]+)\.[^.]+$/i);
  if (!match) return [];
  const bucket = match[1];
  const hash = match[2];
  if (!bucket || !hash) return [];

  const hosts = ["wimg.rule34.xxx", "ws-cdn-video.rule34.xxx"];
  const extPriority = ["mp4", "webm", "gif", "jpg", "jpeg", "png"];
  const candidates: string[] = [];

  for (const host of hosts) {
    for (const ext of extPriority) {
      candidates.push(`https://${host}/images/${bucket}/${hash}.${ext}?${postId}`);
    }
  }

  return candidates;
}

async function resolveBestRule34MediaFromThumb(thumbUrl: string, postId: string): Promise<string | null> {
  const candidates = buildRule34FullCandidates(thumbUrl, postId);
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        headers: {
          "User-Agent": "f-land/0.1 (+electron)",
          Range: "bytes=0-0",
          Accept: "*/*",
        },
      });
      if (!response.ok) continue;
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.includes("text/html")) continue;
      if (!(contentType.includes("video/") || contentType.includes("image/"))) continue;
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchRule34ViaHtml(tags: string, limit: number): Promise<BooruMediaItem[]> {
  const listUrl = `https://rule34.xxx/index.php?page=post&s=list&tags=${encodeURIComponent(tags)}`;
  const listHtml = await fetchText(listUrl);
  if (!listHtml) return [];

  const ids = extractRule34PostIds(listHtml).slice(0, Math.max(1, Math.min(limit, 18)));
  if (ids.length === 0) return [];
  const thumbById = extractRule34ThumbById(listHtml);
  const posts: BooruMediaItem[] = [];
  for (const id of ids) {
    const thumb = thumbById.get(id);
    if (!thumb) continue;
    const full = await resolveBestRule34MediaFromThumb(thumb, id);
    posts.push({
      id: `rule34-${id}`,
      source: "rule34",
      url: full ?? thumb,
      previewUrl: thumb,
    });
  }
  return posts;
}

async function fetchGelbooru(tags: string, limit: number): Promise<BooruMediaItem[]> {
  const url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&limit=${limit}&tags=${encodeURIComponent(tags)}`;
  const xml = await fetchText(url);
  if (!xml) return [];
  return parseXmlPosts(xml, "gelbooru");
}

type DanbooruPost = {
  id?: number | string;
  file_url?: string | null;
  large_file_url?: string | null;
  preview_file_url?: string | null;
};

async function fetchDanbooru(tags: string, limit: number): Promise<BooruMediaItem[]> {
  const query = `${tags} animated video gif`;
  const url = `https://danbooru.donmai.us/posts.json?limit=${limit}&tags=${encodeURIComponent(query)}`;
  const posts = await fetchJson<DanbooruPost[]>(url);
  const list = Array.isArray(posts) ? posts : [];
  return list
    .map((post) => {
      const media = normalizeUrl(post.file_url ?? post.large_file_url ?? post.preview_file_url);
      if (!isSupportedMediaUrl(media)) return null;
      const item: DanbooruMediaItem = {
        id: `danbooru-${post.id ?? media}`,
        source: "danbooru",
        url: media,
        previewUrl: normalizeUrl(post.preview_file_url ?? post.large_file_url) ?? null,
      };
      return item;
    })
    .filter((item): item is DanbooruMediaItem => item !== null);
}

function dedupe(items: BooruMediaItem[]): BooruMediaItem[] {
  const seen = new Set<string>();
  const output: BooruMediaItem[] = [];
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    output.push(item);
  }
  return output;
}

async function searchBooru(prompt: string, limitPerSource: number): Promise<BooruMediaItem[]> {
  const tags = toTagQuery(prompt);
  if (!tags) return [];

  const [rule34Dapi, gelbooru, danbooru] = await Promise.all([
    fetchRule34(tags, limitPerSource),
    fetchGelbooru(tags, limitPerSource),
    fetchDanbooru(tags, limitPerSource),
  ]);
  const rule34 = rule34Dapi.length > 0 ? rule34Dapi : await fetchRule34ViaHtml(tags, limitPerSource);
  return dedupe([...rule34, ...gelbooru, ...danbooru]);
}

export const booruRouter = router({
  searchMedia: publicProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(200),
        limitPerSource: z.number().int().min(1).max(50).default(16),
      }),
    )
    .query(async ({ input }) => {
      const media = await searchBooru(input.prompt, input.limitPerSource);
      return z.array(ZBooruMediaItem).parse(media);
    }),
});
