import React, { useEffect, useState, useCallback } from 'react';
import { AlertCircle, RefreshCw, ChevronDown, ChevronUp, Newspaper } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BriefSection {
  id: string;
  label: string;
  icon: string;
  content: string;
  summary: string;
  order: number;
}

interface BriefUpdate {
  timestamp: string;
  category: string;
  label: string;
  icon: string;
  severity: 'high' | 'medium' | 'low' | 'none';
  headline: string;
  content: string;
}

interface PlayerMention {
  player_name: string;
  team_abbr: string | null;
  context: string;
  section_id: string;
  in_update: boolean;
}

interface ParsedBrief {
  slate_date: string;
  last_updated_at: string | null;
  sections: BriefSection[];
  updates: BriefUpdate[];
  player_mentions: PlayerMention[];
  meta: {
    section_count: number;
    update_count: number;
    high_severity_count: number;
    has_updates: boolean;
  };
}

// ─── Category definitions ─────────────────────────────────────────────────────

const CATEGORIES = [
  {
    id: 'injuries',
    label: 'Injury Report',
    icon: '🩹',
    keywords: ['out', 'questionable', 'doubtful', 'gtd', 'injury', 'injured', 'inactive',
               'ruled out', 'upgraded', 'cleared', 'dnp', 'health', 'will not play',
               'out tonight', 'scratched'],
  },
  {
    id: 'referees',
    label: 'Officials',
    icon: '🦺',
    keywords: ['referee', 'crew', 'foul', 'officiating', 'fta', 'calls', 'whistles'],
  },
  {
    id: 'coaches',
    label: 'Rotations',
    icon: '📋',
    keywords: ['coach', 'rotation', 'bench', 'starter', 'minutes', 'substitution',
               'depth chart', 'lineup', 'blowout'],
  },
  {
    id: 'totals',
    label: 'Game Environment',
    icon: '📊',
    keywords: ['total', 'over/under', 'o/u', 'spread', 'line', 'odds', 'implied',
               'vegas', 'pace', 'points'],
  },
  {
    id: 'exposure',
    label: 'Exposure Recommendations',
    icon: '🎯',
    keywords: ['exposure', 'increase exposure', 'reduce exposure', 'fade', 'target',
               'leverage', 'stack', 'ownership', 'gpp', 'overweight', 'underweight',
               'differentiator', 'hvm', 'ceiling', 'salary'],
  },
] as const;

type CategoryId = typeof CATEGORIES[number]['id'] | 'overview';

const OVERVIEW_CATEGORY = { id: 'overview' as const, label: 'Overview', icon: '📰' };

const SEVERITY_COLOR: Record<string, string> = {
  high: '#EF4444',
  medium: '#F59E0B',
  low: '#6B7280',
  none: '#6B7280',
};

const SEVERITY_LABEL: Record<string, string> = {
  high: 'HIGH',
  medium: 'MED',
  low: 'LOW',
  none: '',
};

const EXPOSURE_TABS = [
  { key: 'target',   label: '🔼 Target',      anchor: /increase exposure/i },
  { key: 'fade',     label: '🔽 Fade',         anchor: /reduce exposure/i },
  { key: 'leverage', label: '⚖️ Leverage',     anchor: /ownership leverage/i },
  { key: 'stacks',   label: '📊 Stacks',        anchor: /game stack/i },
] as const;

type ExposureTabKey = typeof EXPOSURE_TABS[number]['key'];

// ─── Rule-based parser ────────────────────────────────────────────────────────

function classifyText(text: string): typeof CATEGORIES[number] | typeof OVERVIEW_CATEGORY {
  const lower = text.toLowerCase();
  let best = OVERVIEW_CATEGORY as any;
  let bestCount = 0;

  for (const cat of CATEGORIES) {
    const count = cat.keywords.filter((kw) => lower.includes(kw)).length;
    if (count > bestCount) {
      bestCount = count;
      best = cat;
    }
  }
  return best;
}

function getSeverity(text: string): 'high' | 'medium' | 'low' | 'none' {
  const lower = text.toLowerCase();
  if (/ruled out|out tonight|scratched|will not play/.test(lower)) return 'high';
  if (/questionable|gtd|upgraded|downgraded/.test(lower)) return 'medium';
  if (/probable|listed|expected|trending/.test(lower)) return 'low';
  return 'none';
}

function extractDateFromH1(line: string): string | null {
  const m = line.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function extractUpdateTimestamp(line: string): string | null {
  // Matches "### 🔄 Update — 14:32 PST" or "### Update — 2:32 PM PST"
  const m = line.match(/update\s*[—\-]\s*(.+?)(?:\s*pst)?$/i);
  return m ? m[1].trim() : null;
}

function makeHeadline(content: string): string {
  // Take first non-empty sentence or first line, cap at 12 words
  const first = content
    .replace(/^#{1,3}\s+[^\n]+\n?/, '') // strip leading heading
    .replace(/\*\*/g, '')
    .split(/[.\n]/)[0]
    .trim();
  const words = first.split(/\s+/).slice(0, 12);
  return words.join(' ') + (words.length < first.split(/\s+/).length ? '…' : '');
}

function makeSummary(content: string): string {
  return content
    .replace(/^#{1,3}\s+[^\n]+\n?/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 180)
    .trim();
}

/** Very light player-name detection: capitalised First Last pairs. */
function extractPlayerMentions(
  content: string,
  sectionId: string,
  inUpdate: boolean
): PlayerMention[] {
  const mentions: PlayerMention[] = [];
  const seen = new Set<string>();
  // Match "Firstname Lastname" — both capitalised, preceded by space/newline/bullet
  const re = /(?:^|[\s*\-•])([A-Z][a-z]+(?:\s[A-Z][a-z']+)+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1].trim();
    if (seen.has(name)) continue;
    // Skip common false-positives (headings, labels)
    if (/^(The|This|In|For|On|At|All|Key|Game|Last|Next|Week|Note|NBA|DFS|GPP|GTD|DNP)/.test(name)) continue;
    seen.add(name);
    // Try to extract team abbr — look for (XXX) immediately after the name
    const teamMatch = content.slice(m.index).match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(([A-Z]{2,4})\\)`));
    mentions.push({
      player_name: name,
      team_abbr: teamMatch ? teamMatch[1] : null,
      context: makeSummary(content).slice(0, 120),
      section_id: sectionId,
      in_update: inUpdate,
    });
  }
  return mentions;
}

function parseBriefMarkdown(md: string): ParsedBrief {
  const unifiedMd = md.replace(/\n---+\n/g, '\n');

  const sections: BriefSection[] = [];
  // Split content into sections based on `##` headings
  const sectionBlocks = unifiedMd.split(/\n(?=##\s)/);

  let slateDate = new Date().toISOString().slice(0, 10);
  let order = 0;

  for (const block of sectionBlocks) {
    const trimmedBlock = block.trim();
    if (trimmedBlock === '') continue;

    const lines = trimmedBlock.split('\n');
    const heading = lines[0];

    // Extract slate date from H1 heading, but don't treat it as a section
    if (heading.startsWith('# ')) {
      const d = extractDateFromH1(heading);
      if (d) { slateDate = d; }
      continue;
    }

    const content = lines.slice(1).join('\n');
    // The full text including the heading is used for classification
    const fullText = heading + '\n' + content;
    
    const cat = classifyText(fullText);
    sections.push({
      id: cat.id,
      label: heading.replace(/^##\s+/, '').replace(/[🎯-9.]/g, '').trim(),
      icon: cat.icon,
      content: fullText, // Pass the full markdown, including sub-headings
      summary: makeSummary(content),
      order: order++,
    });
  }

  // Updates are no longer parsed from separate blocks
  const updates: BriefUpdate[] = [];

  return {
    slate_date: slateDate,
    last_updated_at: null,
    sections,
    updates,
    player_mentions: [], // Player mentions are not required for the new design
    meta: {
      section_count: sections.length,
      update_count: 0,
      high_severity_count: 0,
      has_updates: false,
    },
  };
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split('\n');
  const nodes: React.ReactNode[] = [];
  let key = 0;
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    nodes.push(
      <ul key={key++} className="space-y-1.5 pl-5 list-disc marker:text-drafting-orange">
        {items.map((item, idx) => (
          <li key={`${key}-${idx}`} className="text-sm text-ink/85 leading-6">
            {inlineMd(item)}
          </li>
        ))}
      </ul>
    );
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,3}\s/.test(trimmed)) {
      flushList();
      const level = (trimmed.match(/^#{1,3}/)?.[0].length ?? 2);
      nodes.push(
        <p
          key={key++}
          className={`font-semibold text-ink mt-4 mb-1 ${
            level === 1 ? 'text-base' : level === 2 ? 'text-sm' : 'text-sm text-ink/80'
          }`}
        >
          {trimmed.replace(/^#{1,3}\s+/, '')}
        </p>
      );
    } else if (/^[-*]\s/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*]\s+/, ''));
    } else if (trimmed === '') {
      flushList();
      nodes.push(<div key={key++} className="h-1" />);
    } else {
      flushList();
      nodes.push(
        <p key={key++} className="text-sm text-ink/85 leading-6">
          {inlineMd(trimmed)}
        </p>
      );
    }
  }
  flushList();
  return <>{nodes}</>;
}

function renderAsList(md: string): React.ReactNode {
  // First, strip out any markdown headings from the content.
  const contentWithoutHeading = md.replace(/^#{1,3}\s[^\n]+\n?/, '');

  const lines = contentWithoutHeading.split('\n');
  const nodes: React.ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    // Treat every non-empty line as a list item.
    nodes.push(
      <li key={key++} className="text-sm text-ink/85 leading-6">
        {inlineMd(trimmed.replace(/^[-*]\s+/, ''))}
      </li>
    );
  }

  return (
    <ul className="space-y-1.5 pl-5 list-disc marker:text-drafting-orange">
      {nodes}
    </ul>
  );
}


function inlineMd(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="font-black text-ink">{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

// ─── Exposure tab parser ──────────────────────────────────────────────────────

function parseExposureTabs(content: string): Record<ExposureTabKey, string> {
  const result: Record<string, string> = { target: '', fade: '' };

  // Split content by tier headings (###)
  const tierBlocks = content.split('\n### ').slice(1);

  for (const tierBlock of tierBlocks) {
    const lines = tierBlock.split('\n');
    const tierName = lines[0];

    const targetLines: string[] = [];
    const fadeLines: string[] = [];
    
    let currentSection = '';
    for (const line of lines.slice(1)) {
        if (line.startsWith('#### Target')) {
            currentSection = 'target';
            continue;
        }
        if (line.startsWith('#### Fade')) {
            currentSection = 'fade';
            continue;
        }

        if (currentSection === 'target' && line.trim().startsWith('-')) {
            targetLines.push(line);
        }
        if (currentSection === 'fade' && line.trim().startsWith('-')) {
            fadeLines.push(line);
        }
    }

    if (targetLines.length > 0) {
        result.target += `### ${tierName}\n${targetLines.join('\n')}\n\n`;
    }
    if (fadeLines.length > 0) {
        result.fade += `### ${tierName}\n${fadeLines.join('\n')}\n\n`;
    }
  }
  
  result.target = result.target.trim();
  result.fade = result.fade.trim();

  return result as Record<ExposureTabKey, string>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSlateDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (!Number.isFinite(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const ExposurePanel: React.FC<{ section: BriefSection }> = ({ section }) => {
  const [activeTab, setActiveTab] = useState<ExposureTabKey>('target');
  const tabs = parseExposureTabs(section.content);

  return (
    <div className="bg-white/75 border border-ink/10 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-ink/10 bg-white/70">
        <span className="text-base leading-none">{section.icon}</span>
        <span className="font-semibold text-sm text-ink">{section.label}</span>
      </div>
      <div className="flex overflow-x-auto border-b border-ink/10 bg-ink/[0.02]">
        {EXPOSURE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 ${
              activeTab === tab.key
                ? 'border-drafting-orange text-drafting-orange'
                : 'border-transparent text-ink/40 hover:text-ink/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="px-5 py-5 min-h-[96px]">
        {tabs[activeTab]
          ? renderMarkdown(tabs[activeTab])
          : <p className="text-sm text-ink/35">No content for this tab.</p>
        }
      </div>
    </div>
  );
};

const SectionCard: React.FC<{ section: BriefSection; defaultExpanded?: boolean }> = ({
  section,
  defaultExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className="bg-white/75 border border-ink/10 rounded-2xl overflow-hidden shadow-sm">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-ink/5 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{section.icon}</span>
          <span className="font-semibold text-sm text-ink">{section.label}</span>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-ink/40 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-ink/40 shrink-0" />
        }
      </button>
      {!expanded && section.summary && (
        <div className="px-5 pb-4 -mt-1">
          <p className="text-sm text-ink/65 leading-6">{section.summary}</p>
        </div>
      )}
      {expanded && (
        <div className="px-5 pb-5 border-t border-ink/5 pt-4">
          <div className="max-w-3xl">
            {['coaches', 'referees'].includes(section.id)
              ? renderAsList(section.content)
              : renderMarkdown(section.content)}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  slateDate: string;
}

const SlateNewsView: React.FC<Props> = ({ slateDate }) => {
  const [brief, setBrief] = useState<ParsedBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBrief = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBrief(null);
    try {
      const resp = await fetch(`/api/brief?date=${slateDate}`);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError((body as any)?.error ?? `HTTP ${resp.status}`);
        return;
      }
      const md = await resp.text();
      setBrief(parseBriefMarkdown(md));
    } catch (e: any) {
      setError(e?.message ?? 'Network error');
    } finally {
      setLoading(false);
    }
  }, [slateDate]);

  useEffect(() => { fetchBrief(); }, [fetchBrief]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-ink/40">
        <RefreshCw className="w-6 h-6 animate-spin" />
        <p className="text-sm font-semibold">Loading brief…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24">
        <AlertCircle className="w-6 h-6 text-red-400" />
        <p className="text-sm font-semibold text-red-500">{error}</p>
        <button
          onClick={fetchBrief}
          className="text-xs font-semibold border border-ink/20 px-3 py-1.5 rounded-md hover:border-drafting-orange hover:text-drafting-orange transition-all"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!brief) return null;

  const exposureSection = brief.sections.find((s) => s.id === 'exposure');
  const rotationSection = brief.sections.find((s) => s.id === 'coaches');
  const refereeSection = brief.sections.find((s) => s.id === 'referees');

  return (
    <div className="space-y-6 max-w-6xl mx-auto">

      {/* Hero band */}
      <div className="bg-white/80 border border-ink/10 rounded-2xl px-6 py-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <Newspaper className="w-4 h-4 text-drafting-orange" />
              <span className="text-sm font-semibold text-ink/60">Slate News</span>
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-ink leading-tight">
              {formatSlateDate(brief.slate_date)}
            </h2>
            <p className="text-sm text-ink/55 mt-1">
              Daily pre-slate breakdown and recommendations
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 w-full lg:w-auto">
            <div className="bg-ink/[0.03] rounded-lg border border-ink/10 px-3 py-2 col-span-2 sm:col-span-1">
              <p className="text-[11px] text-ink/50">Sections</p>
              <p className="text-base font-semibold text-ink">{brief.meta.section_count}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Exposure panel — full width below hero */}
      {exposureSection && <ExposurePanel section={exposureSection} />}

      {/* Main content layout */}
      <div className="grid grid-cols-1 gap-5 items-start">
        <section className="space-y-3">
          {(!rotationSection && !refereeSection) && (
            <div className="bg-white/60 border border-ink/10 rounded-2xl px-5 py-6">
              <p className="text-sm text-ink/45">No pre-slate sections available.</p>
            </div>
          )}
          {rotationSection && <SectionCard section={rotationSection} defaultExpanded={true} />}
          {refereeSection && <SectionCard section={refereeSection} defaultExpanded={true} />}
        </section>
      </div>
    </div>
  );
};

export default SlateNewsView;
