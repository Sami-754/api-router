import { useState } from "react";
import type {
  CrawlResult,
  ExtractResult,
  MapResult,
  ScrapeResult,
  SearchResult,
} from "../../lib/types";
import { Button } from "../../components/ui";

export function ResultView({
  capability,
  json,
}: {
  capability: string;
  json: unknown;
}) {
  const [raw, setRaw] = useState(false);

  if (raw || !json) {
    return (
      <div>
        <div className="result-toolbar" style={{ marginBottom: 8 }}>
          <span className="muted small">raw response</span>
          <Button size="sm" variant="ghost" onClick={() => setRaw(false)}>
            Formatted
          </Button>
        </div>
        <pre className="code-block">{JSON.stringify(json, null, 2)}</pre>
      </div>
    );
  }

  const toolbar = (
    <div className="result-toolbar" style={{ marginBottom: 8 }}>
      <span className="muted small">{capability} result</span>
      <Button size="sm" variant="ghost" onClick={() => setRaw(true)}>
        Raw JSON
      </Button>
    </div>
  );

  if (capability === "search") {
    const results = (json as { results?: SearchResult[] }).results ?? [];
    return (
      <div>
        {toolbar}
        {results.length ? (
          results.map((result) => (
            <div className="search-card" key={result.url}>
              <div className="search-card__title">
                {result.title || result.url}
              </div>
              <div className="search-card__url">{result.url}</div>
              {result.snippet && (
                <div className="search-card__snippet">{result.snippet}</div>
              )}
            </div>
          ))
        ) : (
          <pre className="code-block">{JSON.stringify(json, null, 2)}</pre>
        )}
      </div>
    );
  }

  if (capability === "scrape") {
    const result = json as ScrapeResult;
    return (
      <div>
        {toolbar}
        <div className="search-card">
          <div className="search-card__title">{result.title || result.url}</div>
          <div className="search-card__url">{result.url}</div>
        </div>
        <pre className="code-block" style={{ marginTop: 8 }}>
          {result.markdown || JSON.stringify(json, null, 2)}
        </pre>
      </div>
    );
  }

  if (capability === "extract") {
    const results = (json as ExtractResult).results ?? [];
    return (
      <div>
        {toolbar}
        {results.map((result) => (
          <div className="search-card" key={result.url}>
            <div className="search-card__title">
              {result.title || result.url}
            </div>
            <div className="search-card__url">{result.url}</div>
            {result.error ? (
              <div className="attempt__error" style={{ marginTop: 4 }}>
                {result.error}
              </div>
            ) : (
              <div className="search-card__snippet">
                {result.content?.slice(0, 600)}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (capability === "crawl") {
    const pages = (json as CrawlResult).pages ?? [];
    return (
      <div>
        {toolbar}
        {pages.length ? (
          pages.map((page) => (
            <div className="search-card" key={page.url}>
              <div className="search-card__title">{page.title || page.url}</div>
              <div className="search-card__url">{page.url}</div>
              {page.markdown && (
                <div className="search-card__snippet">
                  {page.markdown.slice(0, 400)}
                </div>
              )}
            </div>
          ))
        ) : (
          <pre className="code-block">{JSON.stringify(json, null, 2)}</pre>
        )}
      </div>
    );
  }

  const links = (json as MapResult).links ?? [];
  return (
    <div>
      {toolbar}
      <div className="search-card">
        <div className="search-card__title">{links.length} links</div>
        {links.map((link) => (
          <div className="search-card__url" key={link.url}>
            {link.title ? `${link.title} — ` : ""}
            {link.url}
          </div>
        ))}
      </div>
    </div>
  );
}
