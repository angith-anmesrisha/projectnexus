import { Fragment, useState, type ReactNode } from 'react';
import { shortcodeToEmoji } from './emoji';

export interface RenderOptions {
  markdown: boolean;
  spoilers: boolean;
  streamer: boolean;
  myUsername: string;
}

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      className={`spoiler ${shown ? 'shown' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={shown ? undefined : 'Spoiler, click to reveal'}
      onClick={() => setShown(true)}
      onKeyDown={(e) => e.key === 'Enter' && setShown(true)}
    >
      {children}
    </span>
  );
}

// Order matters: earlier alternatives win when several could match at a position.
const INLINE =
  /(`[^`\n]+`)|(\|\|[\s\S]+?\|\|)|(\*\*[\s\S]+?\*\*)|(__[\s\S]+?__)|(~~[\s\S]+?~~)|(\*[^*\n]+?\*)|((?<![\w])_[^_\n]+?_(?![\w]))|(https?:\/\/[^\s<]+[^\s<.,:;"')\]])|(@[a-zA-Z0-9_.]{3,24})|(:[a-z0-9_+-]{2,40}:)/g;

function inline(text: string, o: RenderOptions, depth = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  INLINE.lastIndex = 0;
  const re = new RegExp(INLINE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [tok, code, spoiler, bold, under, strike, ital1, ital2, url, mention, shortcode] = m;
    const k = key++;
    const deeper = (s: string) => (depth > 4 ? s : inline(s, o, depth + 1));
    if (code && o.markdown) out.push(<code key={k} className="md-code">{code.slice(1, -1)}</code>);
    else if (spoiler && o.spoilers) out.push(<Spoiler key={k}>{deeper(spoiler.slice(2, -2))}</Spoiler>);
    else if (bold && o.markdown) out.push(<strong key={k}>{deeper(bold.slice(2, -2))}</strong>);
    else if (under && o.markdown) out.push(<u key={k}>{deeper(under.slice(2, -2))}</u>);
    else if (strike && o.markdown) out.push(<s key={k}>{deeper(strike.slice(2, -2))}</s>);
    else if ((ital1 || ital2) && o.markdown) out.push(<em key={k}>{deeper((ital1 || ital2).slice(1, -1))}</em>);
    else if (url) {
      const invite = /\/invite\/[\w-]+/.test(url);
      out.push(
        <a key={k} href={url} target="_blank" rel="noopener noreferrer nofollow" className={o.streamer && invite ? 'streamer-blur' : undefined}>
          {url}
        </a>,
      );
    } else if (mention) {
      const self = mention.slice(1).toLowerCase() === o.myUsername.toLowerCase();
      out.push(
        <span key={k} className={`mention ${self ? 'mention-me' : ''} ${o.streamer ? 'streamer-blur' : ''}`}>
          {mention}
        </span>,
      );
    } else if (shortcode && shortcodeToEmoji(shortcode.slice(1, -1))) {
      out.push(shortcodeToEmoji(shortcode.slice(1, -1)));
    } else out.push(tok);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Turn message text into React nodes. Never produces raw HTML. */
export function renderMessage(text: string, o: RenderOptions): ReactNode {
  if (!o.markdown) return inline(text, o);
  const blocks: ReactNode[] = [];
  const parts = text.split(/```(?:([a-z0-9+#-]{1,16})\n)?([\s\S]*?)```/i);
  // split with 2 capture groups yields: text, lang, code, text, lang, code, ...
  for (let i = 0; i < parts.length; i += 3) {
    const chunk = parts[i];
    if (chunk) {
      const lines = chunk.split('\n');
      let quote: string[] = [];
      const flushQuote = () => {
        if (quote.length) {
          blocks.push(<blockquote key={`q${i}-${blocks.length}`}>{inline(quote.join('\n'), o)}</blockquote>);
          quote = [];
        }
      };
      let buf: string[] = [];
      const flushText = () => {
        if (buf.length) {
          blocks.push(<Fragment key={`t${i}-${blocks.length}`}>{inline(buf.join('\n'), o)}</Fragment>);
          buf = [];
        }
      };
      for (const line of lines) {
        if (line.startsWith('> ')) {
          flushText();
          quote.push(line.slice(2));
        } else {
          flushQuote();
          buf.push(line);
        }
      }
      flushQuote();
      flushText();
    }
    if (i + 2 < parts.length) {
      const lang = parts[i + 1];
      const code = parts[i + 2] ?? '';
      blocks.push(
        <pre key={`c${i}`} className="md-pre" data-lang={lang || undefined}>
          <code>{code.replace(/^\n|\n$/g, '')}</code>
        </pre>,
      );
    }
  }
  return blocks;
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*|\s|:[a-z0-9_+-]{2,40}:)+$/u;

/** True for short messages made only of emoji, which get the jumbo treatment. */
export function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 40 || !EMOJI_ONLY.test(t)) return false;
  return [...t.matchAll(/:([a-z0-9_+-]{2,40}):/g)].every((m) => shortcodeToEmoji(m[1]));
}
