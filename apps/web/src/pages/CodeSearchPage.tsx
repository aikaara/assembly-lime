import { useState, useEffect, useRef, useCallback } from "react";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import { SearchResultCard } from "../components/code-search/SearchResultCard";
import { IndexStatusPanel } from "../components/code-search/IndexStatusPanel";

interface SearchResult {
  id: string;
  repositoryId: string;
  repoFullName: string;
  filePath: string;
  chunkType: string;
  symbolName: string | null;
  language: string;
  startLine: number;
  endLine: number;
  content: string;
  contextHeader: string | null;
  commitSha: string | null;
  similarity: number;
}

interface IndexStatus {
  id: string;
  repositoryId: string;
  repoFullName: string;
  status: string;
  lastIndexedSha: string | null;
  lastIndexedAt: string | null;
  fileCount: number;
  chunkCount: number;
  error: string | null;
}

export function CodeSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [statuses, setStatuses] = useState<IndexStatus[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [language, setLanguage] = useState("");
  const [chunkType, setChunkType] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchStatuses = useCallback(async () => {
    try {
      const data = await api.get<{ statuses: IndexStatus[] }>("/code-search/status");
      setStatuses(data.statuses);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchStatuses();
  }, [fetchStatuses]);

  const doSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }

    setSearching(true);
    try {
      const body: Record<string, unknown> = { query: searchQuery };
      if (language) body.language = language;
      if (chunkType) body.chunkType = chunkType;
      body.limit = 20;

      const data = await api.post<{ results: SearchResult[] }>("/code-search/search", body);
      setResults(data.results);
      setSearched(true);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [language, chunkType]);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(value);
    }, 300);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doSearch(query);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold text-zinc-100 mb-6">Code Search</h1>

      <IndexStatusPanel statuses={statuses} onRefresh={fetchStatuses} />

      <form onSubmit={handleSubmit} className="mt-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search code across all repositories..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-3 pl-11 pr-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-lime-500 focus:outline-none focus:ring-1 focus:ring-lime-500"
          />
        </div>

        <div className="mt-3 flex gap-3">
          <select
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              if (query.trim()) {
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => doSearch(query), 100);
              }
            }}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 focus:border-lime-500 focus:outline-none"
          >
            <option value="">All Languages</option>
            <option value="typescript">TypeScript</option>
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
            <option value="go">Go</option>
            <option value="rust">Rust</option>
            <option value="java">Java</option>
            <option value="ruby">Ruby</option>
          </select>

          <select
            value={chunkType}
            onChange={(e) => {
              setChunkType(e.target.value);
              if (query.trim()) {
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => doSearch(query), 100);
              }
            }}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 focus:border-lime-500 focus:outline-none"
          >
            <option value="">All Types</option>
            <option value="function">Functions</option>
            <option value="class">Classes</option>
            <option value="interface">Interfaces</option>
            <option value="struct">Structs</option>
            <option value="method">Methods</option>
            <option value="file_segment">File Segments</option>
          </select>
        </div>
      </form>

      <div className="mt-6 space-y-4">
        {searching && (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-lime-500 border-t-transparent" />
            <span className="ml-3 text-sm text-zinc-400">Searching...</span>
          </div>
        )}

        {!searching && searched && results.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-zinc-500">
              No results found. Try a different query or check that repositories are indexed.
            </p>
          </div>
        )}

        {!searching &&
          results.map((result) => (
            <SearchResultCard key={result.id} result={result} />
          ))}
      </div>
    </div>
  );
}
