const https = require('https');
const logger = require('../../core/logger').createServiceLogger('ANTHROPIC');

const API_HOSTNAME = 'api.anthropic.com';
const API_PATH = '/v1/messages';
const API_VERSION = '2023-06-01';

// Claude 5 models reject `thinking: {type: "disabled"}` at these effort levels.
const EFFORT_REQUIRING_THINKING = new Set(['xhigh', 'max']);

// Shared across requests so consecutive questions reuse the TLS connection
// instead of paying for a fresh handshake before the first token.
const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });

/**
 * Anthropic Messages API transport.
 *
 * The rest of the app builds Gemini-shaped requests (`contents` / `parts` /
 * `systemInstruction`), so this provider translates that shape into an
 * Anthropic body instead of forcing every caller to know which backend is
 * active. Requests go over plain `https` rather than the official SDK for the
 * same reason the Gemini path keeps a raw-HTTPS fallback: Electron's fetch
 * stack has proven unreliable here, especially for streaming.
 */
class AnthropicProvider {
  get hostname() {
    return API_HOSTNAME;
  }

  /**
   * Convert a Gemini-shaped request into an Anthropic Messages body.
   */
  buildBody(request, model, options = {}) {
    const messages = this._toMessages(request && request.contents);

    if (!messages.length) {
      throw new Error('No user content to send to Anthropic');
    }

    const body = {
      model,
      max_tokens: this._resolveMaxTokens(request, options),
      messages
    };

    const system = this._toSystem(request && request.systemInstruction);
    if (system) {
      body.system = system;
    }

    const effort = options.effort;
    if (effort) {
      body.output_config = { effort };
    }

    // Claude 5 models think by default, which delays the first visible token.
    // The overlay streams answers as they arrive, so thinking stays off unless
    // explicitly requested — and stays on at efforts that forbid disabling it.
    if (options.thinking === true) {
      body.thinking = { type: 'adaptive' };
    } else if (options.thinking === false && !EFFORT_REQUIRING_THINKING.has(effort)) {
      body.thinking = { type: 'disabled' };
    }

    if (options.stream) {
      body.stream = true;
    }

    // temperature / top_p / top_k are deliberately omitted: Claude 4.7+ only
    // accepts the default temperature, and sampling overrides are rejected
    // while thinking is active.
    return body;
  }

  /**
   * Non-streaming request. Resolves to `{ text, stopReason }`.
   */
  async send(request, options = {}) {
    const body = this.buildBody(request, options.model, { ...options, stream: false });
    const response = await this._post(body, options);
    return this.extractText(response);
  }

  /**
   * Streaming request. Invokes `options.onDelta` for each text chunk and
   * resolves to the full concatenated answer.
   */
  stream(request, options = {}) {
    const body = this.buildBody(request, options.model, { ...options, stream: true });
    const payload = JSON.stringify(body);
    const onDelta = options.onDelta;

    return new Promise((resolve, reject) => {
      // Populated when the API reports a mid-stream error; `req.destroy()`
      // then surfaces through the request 'error' handler below.
      let streamError = null;

      const req = https.request(
        this._requestOptions(payload, options, { accept: 'text/event-stream' }),
        (res) => {
          if (res.statusCode !== 200) {
            this._readErrorBody(res, (error) => reject(error));
            return;
          }

          let fullText = '';
          let buffer = '';

          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            buffer += chunk;

            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, newlineIndex).trim();
              buffer = buffer.slice(newlineIndex + 1);

              if (!line.startsWith('data:')) {
                continue;
              }

              const data = line.slice(5).trim();
              if (!data) {
                continue;
              }

              let event;
              try {
                event = JSON.parse(data);
              } catch (_) {
                // Line framing makes split JSON rare; skip anything unparseable.
                continue;
              }

              if (event.type === 'error') {
                const detail = event.error || {};
                streamError = new Error(
                  `Anthropic stream error ${detail.type || 'unknown'}: ${detail.message || 'no message'}`
                );
                req.destroy();
                return;
              }

              // `thinking_delta` chunks are dropped on purpose — only the
              // answer text belongs in the UI.
              if (event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') {
                const piece = event.delta.text || '';
                if (piece) {
                  fullText += piece;
                  if (typeof onDelta === 'function') {
                    onDelta(piece);
                  }
                }
              }
            }
          });

          res.on('end', () => {
            if (streamError) {
              reject(streamError);
              return;
            }
            resolve(fullText.trim());
          });

          res.on('error', (error) => {
            reject(streamError || new Error(`Anthropic stream response error: ${error.message}`));
          });
        }
      );

      req.on('error', (error) => {
        reject(streamError || new Error(`Anthropic stream request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(streamError || new Error('Anthropic stream request timeout'));
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Pull the answer out of a Messages response, skipping `thinking` blocks.
   */
  extractText(response) {
    const blocks = Array.isArray(response && response.content) ? response.content : [];

    const text = blocks
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
      .trim();

    if (!text) {
      const seen = blocks.map((block) => (block && block.type) || 'unknown').join(', ') || 'none';
      throw new Error(
        `No text blocks in Anthropic response (blocks: ${seen}, stop_reason: ${(response && response.stop_reason) || 'unknown'})`
      );
    }

    if (response && response.stop_reason === 'max_tokens') {
      logger.warn('Anthropic response truncated by max_tokens', {
        model: response.model,
        outputTokens: response.usage && response.usage.output_tokens
      });
    }

    return { text, stopReason: (response && response.stop_reason) || null };
  }

  _post(body, options) {
    const payload = JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const req = https.request(this._requestOptions(payload, options), (res) => {
        if (res.statusCode !== 200) {
          this._readErrorBody(res, (error) => reject(error));
          return;
        }

        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new Error(`Failed to parse Anthropic response: ${error.message}`));
          }
        });
        res.on('error', (error) => reject(new Error(`Anthropic response error: ${error.message}`)));
      });

      req.on('error', (error) => reject(new Error(`Anthropic request failed: ${error.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Anthropic request timeout'));
      });

      req.write(payload);
      req.end();
    });
  }

  _requestOptions(payload, options, extraHeaders = {}) {
    return {
      hostname: API_HOSTNAME,
      path: API_PATH,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': options.apiKey,
        'anthropic-version': API_VERSION,
        'content-length': Buffer.byteLength(payload),
        ...extraHeaders
      },
      timeout: options.timeout || 120000,
      agent
    };
  }

  /**
   * Anthropic returns `{ error: { type, message } }` on failure. Surfacing that
   * message verbatim lets the retry policy and settings UI classify the error.
   */
  _readErrorBody(res, done) {
    let raw = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { raw += chunk; });
    res.on('end', () => {
      let detail = raw.slice(0, 500);
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.error && parsed.error.message) {
          detail = `${parsed.error.type || 'error'}: ${parsed.error.message}`;
        }
      } catch (_) { /* fall back to the raw body */ }
      done(new Error(`HTTP ${res.statusCode}: ${detail}`));
    });
    res.on('error', () => done(new Error(`HTTP ${res.statusCode}`)));
  }

  _resolveMaxTokens(request, options) {
    const candidates = [
      options.maxTokens,
      request && request.generationConfig && request.generationConfig.maxOutputTokens
    ];

    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) {
        return Math.floor(value);
      }
    }

    return 4096;
  }

  _toSystem(systemInstruction) {
    if (!systemInstruction) {
      return '';
    }

    if (typeof systemInstruction === 'string') {
      return systemInstruction.trim();
    }

    const parts = Array.isArray(systemInstruction.parts) ? systemInstruction.parts : [];
    return parts
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }

  _toMessages(contents) {
    if (typeof contents === 'string') {
      const text = contents.trim();
      return text ? [{ role: 'user', content: [{ type: 'text', text }] }] : [];
    }

    const messages = [];

    for (const entry of Array.isArray(contents) ? contents : []) {
      const blocks = this._toBlocks(entry && entry.parts);
      if (!blocks.length) {
        continue;
      }

      const role = entry && (entry.role === 'model' || entry.role === 'assistant') ? 'assistant' : 'user';
      const previous = messages[messages.length - 1];

      // Anthropic rejects consecutive same-role turns, which the shared
      // conversation history can contain after filtering.
      if (previous && previous.role === role) {
        previous.content.push(...blocks);
      } else {
        messages.push({ role, content: blocks });
      }
    }

    // A conversation has to open on a user turn.
    while (messages.length && messages[0].role === 'assistant') {
      messages.shift();
    }

    return messages;
  }

  _toBlocks(parts) {
    const textBlocks = [];
    const imageBlocks = [];

    for (const part of Array.isArray(parts) ? parts : []) {
      if (part && typeof part.text === 'string' && part.text.trim()) {
        textBlocks.push({ type: 'text', text: part.text });
      } else if (part && part.inlineData && part.inlineData.data) {
        imageBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: part.inlineData.mimeType || 'image/png',
            data: part.inlineData.data
          }
        });
      }
    }

    // Anthropic's vision guidance is to place images ahead of the question.
    return [...imageBlocks, ...textBlocks];
  }
}

module.exports = new AnthropicProvider();
module.exports.AnthropicProvider = AnthropicProvider;
