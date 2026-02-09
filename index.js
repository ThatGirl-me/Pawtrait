/**
 * Pawtrait 🐾
 * Multi-provider image generation with avatar references and character context
 * Supports NanoGPT, OpenRouter, LinkAPI.ai, Pollinations.ai, and Custom endpoints
 * Author: ThatGirl-me
 * Version 1.0.2
 */

import {
    saveSettingsDebounced,
    appendMediaToMessage,
    eventSource,
    event_types,
    saveChatConditional,
    user_avatar,
    getUserAvatar as getAvatarPath,
    name1,
    characters,
} from '../../../../script.js';

import { getContext, extension_settings } from '../../../extensions.js';
import { getBase64Async, saveBase64AsFile } from '../../../utils.js';
import { power_user } from '../../../power-user.js';
import { MEDIA_DISPLAY, MEDIA_SOURCE, MEDIA_TYPE, SCROLL_BEHAVIOR } from '../../../constants.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../slash-commands/SlashCommandArgument.js';

const extensionName = 'pawtrait';

// Models that support imageDataUrl/imageDataUrls for reference images
const MODELS_WITH_IMAGE_INPUT = [
    'gpt-4o-image',
    'gpt-image-1',
    'gpt-image-1.5',
    'flux-kontext',
    'flux-kontext-pro',
    'flux-kontext-max',
    'gemini-2.0-flash-exp-image',
    'gemini-2.5-flash-preview-native-image',
];

// Subscription models (no image input support)
const SUBSCRIPTION_MODELS = [
    'hidream',
    'chroma',
    'z-image-turbo',
    'qwen-image',
];

const defaultSettings = {
    // API Settings
    provider: 'nano-gpt', // 'nano-gpt' | 'openrouter' | 'linkapi' | 'pollinations' | 'custom'
    api_endpoint: 'https://nano-gpt.com/v1/images/generations',
    custom_api_endpoint: '',
    api_key: '',  // Legacy - kept for backwards compatibility
    model: 'hidream',

    // Per-provider API keys
    api_keys: {
        'nano-gpt': '',
        'openrouter': '',
        'linkapi': '',
        'pollinations': '',  // Required for Pollinations
        'custom': '',
    },

    // Summarizer Settings
    use_summarizer: false,
    auto_summarize: false,
    summarizer_model: 'deepseek-chat-cheaper',

    // Character Description Settings
    char_descriptions: {}, // { "character_name": "custom_description" }
    persona_descriptions: {}, // { "persona_key": "custom_description" }
    active_characters: [], // ["character_name"]

    // Generation Settings
    aspect_ratio: '1:1',
    image_size: '1K', // 1K | 2K | 4K (for models that support tiers)
    max_prompt_length: 1000,
    use_avatars: false,
    include_descriptions: false,
    use_previous_image: false,
    message_depth: 1,
    system_instruction: 'Detailed illustration, high quality.',
    gallery: [],
    log_autoscroll: true,
};

const MAX_GALLERY_SIZE = 50;
const MAX_RUNTIME_LOG_ENTRIES = 300;
const MAX_LOG_STRING_LENGTH = 12000;

const ASPECT_RATIO_LABELS = {
    '1:1': '1:1 Square',
    '16:9': '16:9 Landscape',
    '9:16': '9:16 Portrait',
    '4:3': '4:3 Standard',
    '3:4': '3:4 Portrait',
    '3:2': '3:2 Photo',
    '2:3': '2:3 Portrait Photo',
    '4:5': '4:5 Portrait',
    '5:4': '5:4 Landscape',
    '21:9': '21:9 Cinematic',
};

const DEFAULT_ASPECT_RATIO_OPTIONS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];
const GEMINI_ASPECT_RATIO_OPTIONS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const POLLINATIONS_ASPECT_RATIO_OPTIONS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];
const OPENAI_IMAGE_ASPECT_RATIO_OPTIONS = ['1:1', '3:2', '2:3', '16:9', '9:16'];
const IMAGE_SIZE_TIER_OPTIONS = ['1K', '2K', '4K', '8K'];
const COMMON_IMAGE_DIMENSION_OPTIONS = ['1024x1024', '1536x1024', '1024x1536', '1344x768', '768x1344', '1216x832', '832x1216'];
const MINIMAX_IMAGE_DIMENSION_OPTIONS = ['1024x1024', '1280x720', '1152x864', '1248x832', '832x1248', '864x1152', '720x1280', '1344x576'];
const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

let runtimeLogs = [];
let runtimeLogSequence = 0;
let runtimeLogRenderScheduled = false;
const runtimeExpandedLogIds = new Set();

function getModelCapabilityPreset(modelId, family = 'generic-image', providerId = '') {
    const id = String(modelId || '').toLowerCase();
    const provider = String(providerId || '').toLowerCase();

    const toPreset = (aspectRatios = [], imageSizes = []) => ({
        aspectRatios: [...new Set(aspectRatios
            .map(normalizeAspectRatioValue)
            .filter(Boolean))],
        imageSizes: [...new Set(imageSizes
            .map(normalizeImageSizeOptionValue)
            .filter(Boolean))],
    });

    if (
        family === 'gemini-image' ||
        /(^|[\/\-_])gemini([\/\-_]|$)/.test(id) ||
        /nano[- ]?banana|nanobanana/.test(id)
    ) {
        return toPreset(GEMINI_ASPECT_RATIO_OPTIONS, ['1K', '2K', '4K']);
    }

    if (
        family === 'openai-image' ||
        /gpt[-_]?image|gptimage|dall[- ]?e|gpt-5-image|gpt-4o-image/.test(id)
    ) {
        return toPreset(OPENAI_IMAGE_ASPECT_RATIO_OPTIONS, ['1024x1024', '1536x1024', '1024x1536']);
    }

    if (/minimax[-_/].*image|minimax-image|image-01/.test(id)) {
        return toPreset(
            ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
            MINIMAX_IMAGE_DIMENSION_OPTIONS,
        );
    }

    if (/runwayml-gen4-image|gen4-image/.test(id)) {
        return toPreset(
            ['1:1', '16:9', '9:16', '4:3', '3:4'],
            ['1280x720', '1920x1080'],
        );
    }

    if (
        /flux|stable[-_ ]?diffusion|sdxl|ideogram|recraft|hidream|z-image|qwen-image|seedream|hunyuan-image|glm-image|longcat-image|grok-.*image|imagen|kling-image|bria|lucid|riverflow|klein/.test(id)
    ) {
        return toPreset(DEFAULT_ASPECT_RATIO_OPTIONS, COMMON_IMAGE_DIMENSION_OPTIONS);
    }

    if (provider === 'openrouter') {
        if (id.startsWith('google/')) {
            return toPreset(GEMINI_ASPECT_RATIO_OPTIONS, ['1K', '2K', '4K']);
        }
        if (id.startsWith('openai/')) {
            return toPreset(OPENAI_IMAGE_ASPECT_RATIO_OPTIONS, ['1024x1024', '1536x1024', '1024x1536']);
        }
    }

    return null;
}

/**
 * Get the API key for the currently selected provider
 */
function getCurrentApiKey() {
    const settings = extension_settings[extensionName];
    const provider = settings.provider || 'nano-gpt';

    // Use the provider-specific key if it exists (even if it's intentionally blank)
    if (settings.api_keys && settings.api_keys[provider] !== undefined) {
        return settings.api_keys[provider] || '';
    }

    // Legacy fallback for older installs that don't have provider keys yet
    return settings.api_key || '';
}

/**
 * Set the API key for the currently selected provider
 */
function setCurrentApiKey(key) {
    const settings = extension_settings[extensionName];
    const provider = settings.provider || 'nano-gpt';

    if (!settings.api_keys) {
        settings.api_keys = { ...defaultSettings.api_keys };
    }
    settings.api_keys[provider] = key;

    // Also update legacy field for backwards compatibility
    settings.api_key = key;
}

function showErrorPopup(title, message) {
    addRuntimeLog('error', 'Error popup shown', { title, message });
    const popup = $(`
        <div class="nig_error_overlay">
            <div class="nig_error_popup">
                <div class="nig_error_header">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <span>${title}</span>
                </div>
                <div class="nig_error_body">${message}</div>
                <div class="nig_error_footer">
                    <div class="menu_button nig_error_close">Close</div>
                </div>
            </div>
        </div>
    `);
    popup.on('click', '.nig_error_close', () => popup.remove());
    $('body').append(popup);
}

function summarizeDataUrl(value) {
    const text = String(value || '').trim();
    const match = text.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/i);
    if (!match) return sanitizeLogString(text);

    const mimeType = match[1] || 'application/octet-stream';
    const payloadLength = (match[2] || '').length;
    return `data:${mimeType};base64,[${payloadLength} chars]`;
}

function sanitizeLogString(value) {
    let text = String(value ?? '');
    if (!text) return text;

    // Redact common auth/key patterns.
    text = text.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/ig, 'Bearer [REDACTED]');
    text = text.replace(/\b(sk-or-v1-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{12,}|sk_[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{12,})\b/g, '[REDACTED_KEY]');
    text = text.replace(/([?&](?:api[_-]?key|token|key)=)([^&]+)/ig, '$1[REDACTED]');
    text = text.replace(/data:image\/[^;,]+(?:;[^,]*)?;base64,[A-Za-z0-9+/=\s]+/ig, match => summarizeDataUrl(match));

    if (text.length > MAX_LOG_STRING_LENGTH) {
        const overBy = text.length - MAX_LOG_STRING_LENGTH;
        text = `${text.substring(0, MAX_LOG_STRING_LENGTH)}\n...[truncated ${overBy} chars]`;
    }

    return text;
}

function sanitizeLogValue(value, depth = 0, seen = new WeakSet()) {
    if (depth > 6) return '[MaxDepth]';
    if (value == null) return value;
    if (value instanceof Error) {
        return {
            name: value.name,
            message: sanitizeLogString(value.message || ''),
            stack: sanitizeLogString(value.stack || ''),
        };
    }

    const valueType = typeof value;
    if (valueType === 'string') return sanitizeLogString(value);
    if (valueType === 'number' || valueType === 'boolean') return value;
    if (valueType === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (valueType !== 'object') return sanitizeLogString(value);

    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (Array.isArray(value)) {
        const maxItems = 40;
        const out = value.slice(0, maxItems).map(item => sanitizeLogValue(item, depth + 1, seen));
        if (value.length > maxItems) {
            out.push(`...[+${value.length - maxItems} more items]`);
        }
        return out;
    }

    const out = {};
    const keys = Object.keys(value);
    const maxKeys = 80;
    for (const key of keys.slice(0, maxKeys)) {
        const lowerKey = key.toLowerCase();
        const current = value[key];

        if (/(authorization|api[_-]?key|token|secret|password)/.test(lowerKey)) {
            out[key] = '[REDACTED]';
            continue;
        }

        if (/(imagedataurl|imagedataurls|inline.?data|image.?data|b64|base64)/.test(lowerKey)) {
            if (typeof current === 'string') {
                out[key] = summarizeDataUrl(current);
            } else if (Array.isArray(current)) {
                out[key] = current.map(item => typeof item === 'string' ? summarizeDataUrl(item) : sanitizeLogValue(item, depth + 1, seen));
            } else {
                out[key] = sanitizeLogValue(current, depth + 1, seen);
            }
            continue;
        }

        out[key] = sanitizeLogValue(current, depth + 1, seen);
    }

    if (keys.length > maxKeys) {
        out.__truncated__ = `+${keys.length - maxKeys} more keys`;
    }

    return out;
}

function addRuntimeLog(level, event, details = null) {
    const normalizedLevel = LOG_LEVELS.has(String(level || '').toLowerCase())
        ? String(level).toLowerCase()
        : 'info';

    const entry = {
        id: ++runtimeLogSequence,
        timestamp: new Date().toISOString(),
        level: normalizedLevel,
        event: String(event || 'Event'),
        details: sanitizeLogValue(details),
    };

    runtimeLogs.push(entry);
    if (runtimeLogs.length > MAX_RUNTIME_LOG_ENTRIES) {
        runtimeLogs.shift();
    }

    scheduleRuntimeLogRender();
    return entry;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatRuntimeLogDetails(details) {
    if (details == null) return '';
    if (typeof details === 'string') return details;
    try {
        return JSON.stringify(details, null, 2);
    } catch (error) {
        return String(details);
    }
}

function renderRuntimeLogs(options = {}) {
    const list = $('#nig_logs_list');
    const empty = $('#nig_logs_empty');
    if (!list.length || !empty.length) return;

    const levelFilter = String($('#nig_log_level_filter').val() || 'all').toLowerCase();
    const logs = levelFilter === 'all'
        ? runtimeLogs
        : runtimeLogs.filter(entry => entry.level === levelFilter);

    if (logs.length === 0) {
        list.hide().empty();
        empty.show();
        return;
    }

    // Drop expand state for logs that are no longer in memory.
    const existingIds = new Set(runtimeLogs.map(entry => entry.id));
    for (const id of [...runtimeExpandedLogIds]) {
        if (!existingIds.has(id)) runtimeExpandedLogIds.delete(id);
    }

    const html = logs.map(entry => {
        const detailsText = formatRuntimeLogDetails(entry.details);
        const hasDetails = String(detailsText || '').trim().length > 0;
        const isExpanded = hasDetails && runtimeExpandedLogIds.has(entry.id);
        const detailsBlock = hasDetails && isExpanded
            ? `<pre class="nig_log_details">${escapeHtml(detailsText)}</pre>`
            : '';
        const toggleLabel = isExpanded ? 'Collapse' : 'Expand';
        const toggleButton = hasDetails
            ? `<button type="button" class="nig_log_toggle" data-log-id="${entry.id}">${toggleLabel}</button>`
            : '';

        return `
            <div class="nig_log_item">
                <div class="nig_log_head">
                    <span class="nig_log_time">${escapeHtml(entry.timestamp)}</span>
                    <span class="nig_log_level ${escapeHtml(entry.level)}">${escapeHtml(entry.level)}</span>
                    <span class="nig_log_event">${escapeHtml(entry.event)}</span>
                    ${toggleButton}
                </div>
                ${detailsBlock}
            </div>
        `;
    }).join('');

    list.html(html).show();
    empty.hide();

    const shouldAutoScroll = options?.suppressAutoscroll
        ? false
        : $('#nig_log_autoscroll').is(':checked');
    if (shouldAutoScroll) {
        list.scrollTop(list[0].scrollHeight);
    }
}

function scheduleRuntimeLogRender() {
    if (runtimeLogRenderScheduled) return;
    runtimeLogRenderScheduled = true;
    setTimeout(() => {
        runtimeLogRenderScheduled = false;
        renderRuntimeLogs();
    }, 0);
}

function clearRuntimeLogs() {
    runtimeLogs = [];
    runtimeExpandedLogIds.clear();
    scheduleRuntimeLogRender();
}

function getRuntimeLogsText() {
    return runtimeLogs.map(entry => {
        const detailsText = formatRuntimeLogDetails(entry.details);
        return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.event}${detailsText ? `\n${detailsText}` : ''}`;
    }).join('\n\n');
}

async function copyRuntimeLogsToClipboard() {
    const text = getRuntimeLogsText();
    if (!text.trim()) throw new Error('No logs to copy');

    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = $('<textarea>')
        .val(text)
        .css({ position: 'fixed', left: '-9999px', top: '-9999px' })
        .appendTo('body');
    textarea[0].focus();
    textarea[0].select();
    const copied = document.execCommand('copy');
    textarea.remove();

    if (!copied) throw new Error('Clipboard copy failed');
}

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};

    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = value;
        }
    }

    // Ensure api_keys object exists with all providers
    if (!extension_settings[extensionName].api_keys) {
        extension_settings[extensionName].api_keys = { ...defaultSettings.api_keys };
    }
    for (const provider of Object.keys(defaultSettings.api_keys)) {
        if (extension_settings[extensionName].api_keys[provider] === undefined) {
            extension_settings[extensionName].api_keys[provider] = '';
        }
    }

    // Migrate legacy api_key only when no provider-specific keys are set yet
    const s = extension_settings[extensionName];
    const hasAnyProviderKey = Object.values(s.api_keys || {}).some(value => String(value || '').trim().length > 0);
    if (s.api_key && !hasAnyProviderKey) {
        s.api_keys[s.provider] = s.api_key;
    }

    // Preserve existing custom endpoint for users upgrading from older settings
    if (!s.custom_api_endpoint && s.provider === 'custom' && s.api_endpoint) {
        s.custom_api_endpoint = s.api_endpoint;
    }

    $('#nig_api_endpoint').val(s.api_endpoint);
    $('#nig_api_key').val(getCurrentApiKey());  // Show current provider's key
    $('#nig_aspect_ratio').val(s.aspect_ratio);
    const normalizedImageSize = normalizeImageSizeOptionValue(s.image_size) || defaultSettings.image_size;
    s.image_size = normalizedImageSize;
    $('#nig_image_size').val(normalizedImageSize);
    $('#nig_max_prompt_length').val(s.max_prompt_length);
    $('#nig_use_avatars').prop('checked', s.use_avatars);
    $('#nig_include_descriptions').prop('checked', s.include_descriptions);
    $('#nig_use_previous_image').prop('checked', s.use_previous_image);
    $('#nig_message_depth').val(s.message_depth);
    $('#nig_message_depth_value').text(s.message_depth);
    $('#nig_system_instruction').val(s.system_instruction);
    $('#nig_summarizer_model').val(s.summarizer_model);
    $('#nig_auto_summarize').prop('checked', s.auto_summarize);
    $('#nig_log_autoscroll').prop('checked', s.log_autoscroll !== false);
    $('#nig_log_level_filter').val('all');
    scheduleRuntimeLogRender();

    // Character description settings
    populateCharacterDropdown();
    populateActiveCharacterDropdown();
    populatePersonaDropdown();
    updateSavedCharactersList();
    updateActiveCharactersList();
    updateSavedPersonasList();

    // Provider
    $('#nig_provider').val(s.provider || defaultSettings.provider);

    // Show/hide endpoint URL field (only for custom)
    if (s.provider === 'custom') {
        $('#nig_endpoint_field').show();
    } else {
        $('#nig_endpoint_field').hide();
    }

    // Auto-fetch models if API key is set or provider doesn't require one
    const providerConfig = getProviderConfig(s);
    if (getCurrentApiKey() || providerConfig.noApiKeyRequired) {
        // Fetch both image and chat model lists silently (if available)
        await fetchModelsFromAPI(true); // Silent mode - no toasts on load
        await fetchSummarizerModelsFromAPI(true);
        // Model will be restored by updateModelDropdown/updateSummarizerDropdown using saved setting
    } else {
        // No API key - just show placeholder
        $('#nig_model').val(s.model);
    }

    updateModelInfo();
    renderGallery();
}

// Cache for fetched models data
let cachedModels = [];
let cachedChatModels = []; // Cache for chat/summarizer models

async function fetchSummarizerModelsFromAPI(silent = false) {
    const settings = extension_settings[extensionName];
    const providerConfig = getProviderConfig(settings);
    // For summarizer, prefer the test URL (standard /v1/models) which has chat models
    const modelsUrl = providerConfig.modelsTestUrl || providerConfig.modelsUrl || settings.api_endpoint;
    addRuntimeLog('info', 'Fetching summarizer models', {
        provider: providerConfig.id,
        modelsUrl,
        silent,
    });

    if (!modelsUrl) {
        if (!silent) toastr.info('Model listing not available for selected provider.', 'Pawtrait');
        addRuntimeLog('warn', 'Summarizer model fetch skipped: no URL', {
            provider: providerConfig.id,
        });
        return;
    }

    const btn = $('#nig_fetch_summarizer_models_btn');
    if (btn.length) btn.find('i').removeClass('fa-rotate').addClass('fa-spinner fa-spin');

    try {
        const headers = { 'Accept': 'application/json' };
        if (getCurrentApiKey()) headers['Authorization'] = `Bearer ${getCurrentApiKey()}`;

        const response = await fetch(modelsUrl, { method: 'GET', headers });
        addRuntimeLog('debug', 'Summarizer models response status', {
            provider: providerConfig.id,
            status: response.status,
            ok: response.ok,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        // Get raw bytes to check for gzip compression
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        let jsonText;

        // Check if response is gzip compressed (starts with 0x1f 0x8b)
        if (providerConfig.supportsGzipModelsResponse && bytes[0] === 0x1f && bytes[1] === 0x8b) {
            // Use DecompressionStream API (modern browsers)
            if (typeof DecompressionStream !== 'undefined') {
                const ds = new DecompressionStream('gzip');
                const decompressedStream = new Response(arrayBuffer).body.pipeThrough(ds);
                jsonText = await new Response(decompressedStream).text();
            } else if (typeof pako !== 'undefined') {
                jsonText = pako.ungzip(bytes, { to: 'string' });
            } else {
                throw new Error('Cannot decompress gzip response');
            }
        } else {
            jsonText = new TextDecoder().decode(bytes);
        }

        const data = JSON.parse(jsonText);
        const models = data.data || data.models || (Array.isArray(data) ? data : []);

        cachedChatModels = models;
        console.log(`[${extensionName}] Fetched ${models.length} summarizer models from API`);
        addRuntimeLog('info', 'Summarizer models fetched', {
            provider: providerConfig.id,
            totalModels: models.length,
        });

        // Populate summarizer dropdown
        const select = $('#nig_summarizer_model');
        if (select.length) {
            const current = select.val();
            select.empty();

            // Filter for good summarizer models - cheap, fast text models
            const chatCandidates = models.filter(m => {
                const id = (m.id || m.name || '').toString().toLowerCase();
                const desc = (m.description || '').toString().toLowerCase();

                // For Pollinations format: check output_modalities
                if (m.output_modalities && Array.isArray(m.output_modalities)) {
                    // Must output text
                    if (!m.output_modalities.includes('text')) return false;
                    // Exclude if it ONLY outputs non-text (image/video)
                    if (m.output_modalities.length === 1 && !m.output_modalities.includes('text')) return false;
                }

                // Exclude specialized models (Pollinations specific)
                if (m.is_specialized === true) return false;

                // Exclude non-text models by name
                if (/image|diffusion|dall-e|flux|stable|midjourney|embed|whisper|tts-|video|seedance|veo|wan|nanobanana|seedream|gptimage|klein/.test(id)) {
                    return false;
                }

                // Include if it matches known chat model patterns OR has text output
                const isKnownChatModel = /gpt|openai|claude|gemini|deepseek|llama|mistral|qwen|phi|command|grok|nova|kimi|glm|minimax|perplexity|sonar/.test(id);
                const hasTextOutput = m.output_modalities?.includes('text');

                return isKnownChatModel || hasTextOutput;
            });

            console.log(`[${extensionName}] Filtered to ${chatCandidates.length} chat candidates`);
            addRuntimeLog('debug', 'Summarizer candidates filtered', {
                provider: providerConfig.id,
                totalModels: models.length,
                candidateCount: chatCandidates.length,
            });

            // Sort by preference: cheaper/faster models first
            const preferenceOrder = ['openai-fast', 'nova-fast', 'gemini-fast', 'openai', 'deepseek', 'gpt-4o-mini', 'gpt-4.1-nano', 'gpt-3.5', 'gemini-flash', 'gemini', 'claude-fast', 'claude-haiku', 'claude', 'mistral', 'grok', 'llama', 'qwen', 'kimi', 'glm', 'minimax'];

            chatCandidates.sort((a, b) => {
                const idA = (a.id || a.name || '').toLowerCase();
                const idB = (b.id || b.name || '').toLowerCase();

                let scoreA = preferenceOrder.findIndex(p => idA.includes(p));
                let scoreB = preferenceOrder.findIndex(p => idB.includes(p));

                if (scoreA === -1) scoreA = 999;
                if (scoreB === -1) scoreB = 999;

                return scoreA - scoreB;
            });

            // Limit to top 20 models to avoid overwhelming the dropdown
            const limitedCandidates = chatCandidates.slice(0, 20);

            if (limitedCandidates.length === 0) {
                // Fallback: show first 15 models that output text
                const fallbackModels = models.filter(m => !m.is_specialized && m.output_modalities?.includes('text')).slice(0, 15);
                if (fallbackModels.length === 0) {
                    // Ultimate fallback: just show first 15 models
                    for (const m of models.slice(0, 15)) {
                        const modelId = m.id || m.name;
                        const displayName = m.description || m.name || m.id;
                        select.append(`<option value="${modelId}">${displayName}</option>`);
                    }
                } else {
                    for (const m of fallbackModels) {
                        const modelId = m.id || m.name;
                        const displayName = m.description || m.name || m.id;
                        select.append(`<option value="${modelId}">${displayName}</option>`);
                    }
                }
            } else {
                for (const m of limitedCandidates) {
                    const modelId = m.id || m.name;
                    // Use description if available (Pollinations has nice descriptions)
                    const displayName = m.description || m.name || m.id;
                    select.append(`<option value="${modelId}">${displayName}</option>`);
                }
            }

            // Restore previous or saved selection
            const saved = extension_settings[extensionName].summarizer_model;
            if (saved && select.find(`option[value="${saved}"]`).length) {
                select.val(saved);
            } else if (current && select.find(`option[value="${current}"]`).length) {
                select.val(current);
            }
        }

        if (!silent) toastr.success(`Found ${models.length} models`, 'Pawtrait');
    } catch (error) {
        console.error(`[${extensionName}] Error fetching summarizer models:`, error);
        addRuntimeLog('error', 'Failed to fetch summarizer models', {
            provider: providerConfig.id,
            modelsUrl,
            error,
        });
        if (!silent) toastr.error(`Failed to fetch models: ${error.message}`, 'Pawtrait');
    } finally {
        if (btn.length) btn.find('i').removeClass('fa-spinner fa-spin').addClass('fa-rotate');
    }
}

function findPreferredSummarizerFromCachedModels() {
    const prefs = ['deepseek-chat', 'gpt-4o-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4', 'gpt-3.5', 'claude-3-haiku', 'gemini-2.0-flash'];
    const ids = cachedChatModels.map(m => (m.id || m.name || '').toString().toLowerCase());
    for (const p of prefs) {
        const found = cachedChatModels.find(m => ids.includes((m.id || m.name || '').toString().toLowerCase()) && (m.id || m.name || '').toString().toLowerCase().includes(p));
        if (found) return found.id || found.name;
    }
    // Fallback: return first chat-like model
    const chatLike = cachedChatModels.find(m => /(gpt|claude|gemini|deepseek|chat|sonnet)/i.test(m.id || m.name || ''));
    return chatLike ? (chatLike.id || chatLike.name) : null;
}

function getAvailableCharacters() {
    const context = getContext();
    let charList = context.characters;
    if (!charList || charList.length === 0) {
        charList = characters || [];
    }
    return Array.isArray(charList) ? charList : [];
}

function getCharacterByName(charName) {
    if (!charName) return null;
    return getAvailableCharacters().find(char => char?.name === charName) || null;
}

function normalizeCharacterNames(names) {
    if (!Array.isArray(names)) return [];

    const unique = [];
    const seen = new Set();
    for (const name of names) {
        const trimmed = String(name || '').trim();
        if (!trimmed) continue;
        if (seen.has(trimmed)) continue;
        seen.add(trimmed);
        unique.push(trimmed);
    }
    return unique;
}

function getActiveCharacterNames() {
    const settings = extension_settings[extensionName];
    settings.active_characters = normalizeCharacterNames(settings.active_characters);
    return settings.active_characters;
}

function populateCharacterDropdown() {
    const select = $('#nig_char_select');
    const previousValue = select.val(); // Remember current selection
    select.empty();
    select.append('<option value="">-- Select a character --</option>');

    const context = getContext();
    const charList = getAvailableCharacters();

    console.log(`[${extensionName}] populateCharacterDropdown: found ${charList.length} characters`);

    if (charList.length > 0) {
        const sorted = [...charList].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        for (const char of sorted) {
            if (char.name) {
                select.append(`<option value="${char.name}">${char.name}</option>`);
            }
        }
    }

    // Try to restore previous selection, or select current character if in chat
    if (previousValue && select.find(`option[value="${previousValue}"]`).length) {
        select.val(previousValue);
        loadCharacterDescription(previousValue);
    } else if (context.characterId !== undefined && charList[context.characterId]) {
        const currentChar = charList[context.characterId];
        if (currentChar?.name) {
            select.val(currentChar.name);
            loadCharacterDescription(currentChar.name);
        }
    }
}

function populateActiveCharacterDropdown() {
    const select = $('#nig_active_char_select');
    if (!select.length) return;

    const previousValue = select.val();
    select.empty();
    select.append('<option value="">-- Select a character --</option>');

    const activeNames = new Set(getActiveCharacterNames());
    const charList = getAvailableCharacters();

    if (charList.length > 0) {
        const sorted = [...charList].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        for (const char of sorted) {
            if (!char?.name) continue;
            if (activeNames.has(char.name)) continue;
            select.append(`<option value="${char.name}">${char.name}</option>`);
        }
    }

    if (previousValue && select.find(`option[value="${previousValue}"]`).length) {
        select.val(previousValue);
    }
}

function addActiveCharacter(charName) {
    const name = String(charName || '').trim();
    if (!name) return false;

    const activeChars = getActiveCharacterNames();
    if (activeChars.includes(name)) return false;

    activeChars.push(name);
    extension_settings[extensionName].active_characters = normalizeCharacterNames(activeChars);
    saveSettingsDebounced();
    updateActiveCharactersList();
    populateActiveCharacterDropdown();
    return true;
}

function removeActiveCharacter(charName) {
    const activeChars = getActiveCharacterNames();
    const filtered = activeChars.filter(name => name !== charName);
    extension_settings[extensionName].active_characters = filtered;
    saveSettingsDebounced();
    updateActiveCharactersList();
    populateActiveCharacterDropdown();
}

function updateActiveCharactersList() {
    const container = $('#nig_active_chars_list');
    if (!container.length) return;

    container.empty();
    const activeChars = getActiveCharacterNames();

    if (activeChars.length === 0) {
        container.html('<small class="nig_hint" style="display:block;">No active characters selected</small>');
        return;
    }

    container.append('<small class="nig_hint" style="margin-bottom:8px;display:block;"><strong>Used in Edit & Generate:</strong></small>');

    const sorted = [...activeChars].sort((a, b) => a.localeCompare(b));
    for (const name of sorted) {
        const desc = getEffectiveCharacterDescriptionByName(name);
        const shortDesc = desc ? (desc.length > 70 ? `${desc.substring(0, 70)}...` : desc) : 'No visual description found';
        const exists = !!getCharacterByName(name);
        const status = exists ? '' : ' <small class="nig_hint">(missing)</small>';

        container.append(`
            <div class="nig_saved_item" data-name="${name}">
                <span class="nig_saved_name">${name}${status}</span>
                <span class="nig_saved_desc">${shortDesc}</span>
                <div class="nig_saved_actions">
                    <i class="fa-solid fa-trash nig_remove_active_char" data-name="${name}" title="Remove"></i>
                </div>
            </div>
        `);
    }
}

/**
 * Load character description - auto-loads from card, shows custom if saved
 */
function loadCharacterDescription(charName) {
    if (!charName) {
        $('#nig_char_description').val('');
        $('#nig_char_name_label').text('selected character');
        return;
    }

    const settings = extension_settings[extensionName];
    $('#nig_char_name_label').text(charName);

    // Check if custom description exists
    const customDesc = settings.char_descriptions?.[charName];
    if (customDesc) {
        $('#nig_char_description').val(customDesc);
    } else {
        // Load from character card
        const cardDesc = getCharacterCardDescription(charName);
        const cleaned = cardDesc ? cleanText(cardDesc).substring(0, 1000) : '';
        $('#nig_char_description').val(cleaned);
    }
}

/**
 * Get the character card description for a character
 */
function getCharacterCardDescription(charName) {
    const char = getCharacterByName(charName);
    return char?.description || '';
}

/**
 * Save character custom description
 */
function saveCharacterDescription() {
    const charName = $('#nig_char_select').val();
    if (!charName) return;

    const settings = extension_settings[extensionName];
    if (!settings.char_descriptions) settings.char_descriptions = {};

    const desc = $('#nig_char_description').val().trim();
    if (desc) {
        settings.char_descriptions[charName] = desc;
        toastr.success(`Saved custom description for ${charName}`, 'Pawtrait');
    } else {
        delete settings.char_descriptions[charName];
    }

    saveSettingsDebounced();
    updateSavedCharactersList();
    updateActiveCharactersList();
}

/**
 * Reset character description to card default
 */
function resetCharacterDescription() {
    const charName = $('#nig_char_select').val();
    if (!charName) return;

    const cardDesc = getCharacterCardDescription(charName);
    const cleaned = cardDesc ? cleanText(cardDesc).substring(0, 1000) : '';
    $('#nig_char_description').val(cleaned);

    // Remove custom description
    const settings = extension_settings[extensionName];
    if (settings.char_descriptions?.[charName]) {
        delete settings.char_descriptions[charName];
        saveSettingsDebounced();
        updateSavedCharactersList();
        updateActiveCharactersList();
        toastr.info(`Reset ${charName} to card description`, 'Pawtrait');
    }
}

/**
 * Update saved characters list with edit functionality
 */
function updateSavedCharactersList() {
    const settings = extension_settings[extensionName];
    const container = $('#nig_char_saved_list');
    container.empty();

    const chars = Object.keys(settings.char_descriptions || {});
    if (chars.length === 0) {
        container.html('<small class="nig_hint" style="margin-top: 12px; display: block;">No custom descriptions saved yet</small>');
        return;
    }

    container.append('<small class="nig_hint" style="margin-top: 12px; margin-bottom: 8px; display: block;"><strong>Custom Descriptions:</strong></small>');
    for (const name of chars.sort()) {
        const desc = settings.char_descriptions[name];
        const shortDesc = desc.length > 50 ? desc.substring(0, 50) + '...' : desc;
        container.append(`
            <div class="nig_saved_item" data-name="${name}">
                <span class="nig_saved_name">${name}</span>
                <span class="nig_saved_desc">${shortDesc}</span>
                <div class="nig_saved_actions">
                    <i class="fa-solid fa-pen nig_edit_char_desc" data-name="${name}" title="Edit"></i>
                    <i class="fa-solid fa-trash nig_delete_char_desc" data-name="${name}" title="Delete"></i>
                </div>
            </div>
        `);
    }
}

/**
 * Populate the persona dropdown
 */
function populatePersonaDropdown() {
    const select = $('#nig_persona_select');
    const previousValue = select.val();
    select.empty();
    select.append('<option value="">-- Select a persona --</option>');

    // Get personas from power_user
    const personas = power_user.personas || {};
    const personaKeys = Object.keys(personas);

    console.log(`[${extensionName}] populatePersonaDropdown: found ${personaKeys.length} personas`);

    if (personaKeys.length > 0) {
        const sorted = personaKeys.sort((a, b) => {
            const nameA = personas[a] || a;
            const nameB = personas[b] || b;
            return nameA.localeCompare(nameB);
        });

        for (const key of sorted) {
            const name = personas[key] || key;
            select.append(`<option value="${key}">${name}</option>`);
        }
    }

    // Restore previous selection if still available
    if (previousValue && select.find(`option[value="${previousValue}"]`).length) {
        select.val(previousValue);
    }
}

/**
 * Get persona description by key from power_user
 */
function getPersonaDescriptionFromPowerUser(personaKey) {
    if (!personaKey) return '';
    const desc = power_user.persona_descriptions?.[personaKey];
    return desc?.description || '';
}

/**
 * Load persona description - auto-loads from persona, shows custom if saved
 */
function loadPersonaDescription(personaKey) {
    if (!personaKey) {
        $('#nig_persona_description').val('');
        $('#nig_persona_name_label').text('selected persona');
        return;
    }

    const settings = extension_settings[extensionName];
    const personaName = power_user.personas?.[personaKey] || personaKey;
    $('#nig_persona_name_label').text(personaName);

    // Check if custom description exists
    const customDesc = settings.persona_descriptions?.[personaKey];
    if (customDesc) {
        $('#nig_persona_description').val(customDesc);
    } else {
        // Load from persona
        const personaDesc = getPersonaDescriptionFromPowerUser(personaKey);
        const cleaned = personaDesc ? cleanText(personaDesc).substring(0, 1000) : '';
        $('#nig_persona_description').val(cleaned);
    }
}

/**
 * Save persona custom description
 */
function savePersonaDescription() {
    const personaKey = $('#nig_persona_select').val();
    if (!personaKey) return;

    const settings = extension_settings[extensionName];
    if (!settings.persona_descriptions) settings.persona_descriptions = {};

    const desc = $('#nig_persona_description').val().trim();
    const personaName = power_user.personas?.[personaKey] || personaKey;

    if (desc) {
        settings.persona_descriptions[personaKey] = desc;
        toastr.success(`Saved custom description for ${personaName}`, 'Pawtrait');
    } else {
        delete settings.persona_descriptions[personaKey];
    }

    saveSettingsDebounced();
    updateSavedPersonasList();
}

/**
 * Reset persona description to default
 */
function resetPersonaDescription() {
    const personaKey = $('#nig_persona_select').val();
    if (!personaKey) return;

    const personaDesc = getPersonaDescriptionFromPowerUser(personaKey);
    const cleaned = personaDesc ? cleanText(personaDesc).substring(0, 1000) : '';
    $('#nig_persona_description').val(cleaned);

    // Remove custom description
    const settings = extension_settings[extensionName];
    const personaName = power_user.personas?.[personaKey] || personaKey;

    if (settings.persona_descriptions?.[personaKey]) {
        delete settings.persona_descriptions[personaKey];
        saveSettingsDebounced();
        updateSavedPersonasList();
        toastr.info(`Reset ${personaName} to default description`, 'Pawtrait');
    }
}

/**
 * Update saved personas list with edit functionality
 */
function updateSavedPersonasList() {
    const settings = extension_settings[extensionName];
    const container = $('#nig_persona_saved_list');
    container.empty();

    const personaKeys = Object.keys(settings.persona_descriptions || {});
    if (personaKeys.length === 0) {
        container.html('<small class="nig_hint" style="margin-top: 12px; display: block;">No custom descriptions saved yet</small>');
        return;
    }

    container.append('<small class="nig_hint" style="margin-top: 12px; margin-bottom: 8px; display: block;"><strong>Custom Descriptions:</strong></small>');
    for (const key of personaKeys.sort()) {
        const desc = settings.persona_descriptions[key];
        const name = power_user.personas?.[key] || key;
        const shortDesc = desc.length > 50 ? desc.substring(0, 50) + '...' : desc;
        container.append(`
            <div class="nig_saved_item" data-key="${key}">
                <span class="nig_saved_name">${name}</span>
                <span class="nig_saved_desc">${shortDesc}</span>
                <div class="nig_saved_actions">
                    <i class="fa-solid fa-pen nig_edit_persona_desc" data-key="${key}" title="Edit"></i>
                    <i class="fa-solid fa-trash nig_delete_persona_desc" data-key="${key}" title="Delete"></i>
                </div>
            </div>
        `);
    }
}

/**
 * Get the effective character description for a specific character name
 * Priority: custom description > character card description
 */
function getEffectiveCharacterDescriptionByName(charName) {
    const settings = extension_settings[extensionName];
    if (!charName) return '';

    if (settings.char_descriptions && settings.char_descriptions[charName]) {
        return cleanText(settings.char_descriptions[charName]).substring(0, 500);
    }

    const cardDesc = getCharacterCardDescription(charName);
    return cardDesc ? cleanText(cardDesc).substring(0, 500) : '';
}

/**
 * Get the effective character description for the current character
 * Priority: custom description > character card description
 */
function getEffectiveCharDescription() {
    const settings = extension_settings[extensionName];
    const context = getContext();

    // Get current character name
    const charList = getAvailableCharacters();
    const currentChar = charList[context.characterId];
    const charName = currentChar?.name;

    console.log(`[${extensionName}] getEffectiveCharDescription: charName="${charName}"`);
    console.log(`[${extensionName}] Saved char_descriptions keys:`, Object.keys(settings.char_descriptions || {}));

    const description = getEffectiveCharacterDescriptionByName(charName);
    if (description) return description;

    console.log(`[${extensionName}] No description found for ${charName}`);
    return '';
}

/**
 * Get the effective user description
 * Priority: custom persona description > persona description > current persona
 */
function getEffectiveUserDescription() {
    const settings = extension_settings[extensionName];

    // Get the current user avatar filename - this is the key used for personas
    const currentAvatarKey = user_avatar;

    console.log(`[${extensionName}] getEffectiveUserDescription: currentAvatarKey="${currentAvatarKey}"`);
    console.log(`[${extensionName}] Saved persona_descriptions keys:`, Object.keys(settings.persona_descriptions || {}));
    console.log(`[${extensionName}] power_user.personas:`, power_user.personas);

    // First check for custom description using the avatar key (most reliable)
    if (currentAvatarKey && settings.persona_descriptions && settings.persona_descriptions[currentAvatarKey]) {
        console.log(`[${extensionName}] USING CUSTOM persona description for avatar key: ${currentAvatarKey}`);
        return settings.persona_descriptions[currentAvatarKey];
    }

    // Try all saved persona descriptions and check if any matches the current user
    const personas = power_user.personas || {};
    for (const [key, personaName] of Object.entries(personas)) {
        if (settings.persona_descriptions && settings.persona_descriptions[key]) {
            // Check if this persona matches current user name or avatar
            if (personaName === name1 || key === currentAvatarKey) {
                console.log(`[${extensionName}] USING CUSTOM persona description for ${personaName} (key: ${key})`);
                return settings.persona_descriptions[key];
            }
        }
    }

    // Fall back to current persona description from power_user
    if (power_user.persona_description) {
        console.log(`[${extensionName}] Using DEFAULT persona description from power_user`);
        return cleanText(power_user.persona_description).substring(0, 500);
    }

    console.log(`[${extensionName}] No persona description found`);
    return '';
}

function normalizeModelIdentifier(modelOrId) {
    if (!modelOrId) return '';
    if (typeof modelOrId === 'string') return modelOrId.trim();
    return String(modelOrId.id || modelOrId.name || '').trim();
}

function readNestedField(source, path) {
    if (!source || !path) return undefined;
    const segments = String(path).split('.');
    let current = source;
    for (const segment of segments) {
        if (current == null || typeof current !== 'object') return undefined;
        current = current[segment];
    }
    return current;
}

function findCachedModelById(modelId) {
    const normalized = normalizeModelIdentifier(modelId).toLowerCase();
    if (!normalized) return null;
    return cachedModels.find(m => normalizeModelIdentifier(m).toLowerCase() === normalized) || null;
}

function getModelModalities(model, kind = 'input') {
    if (!model || typeof model !== 'object') return [];

    const candidates = kind === 'output'
        ? [
            model.architecture?.output_modalities,
            model.output_modalities,
            model.capabilities?.output_modalities,
        ]
        : [
            model.architecture?.input_modalities,
            model.input_modalities,
            model.capabilities?.input_modalities,
        ];

    for (const value of candidates) {
        if (Array.isArray(value) && value.length > 0) {
            return value.map(v => String(v).toLowerCase());
        }
    }

    return [];
}

function getModelSupportedParameters(model) {
    const values = model?.supported_parameters || model?.supportedParameters;
    if (Array.isArray(values)) return values.map(v => String(v).toLowerCase());
    if (values && typeof values === 'object') return Object.keys(values).map(v => String(v).toLowerCase());
    return [];
}

function inferModelFamily(modelId, modelData = null) {
    const id = String(modelId || '').toLowerCase();
    const name = String(modelData?.name || '').toLowerCase();
    const displayName = String(modelData?.displayName || '').toLowerCase();
    const description = String(modelData?.description || '').toLowerCase();
    const owner = String(modelData?.owned_by || modelData?.ownedBy || '').toLowerCase();
    const outputModalities = getModelModalities(modelData, 'output');
    const source = [id, name, displayName, description, owner].filter(Boolean).join(' ');

    if (!source) return 'generic-image';
    if (owner.includes('gemini') && outputModalities.includes('image')) return 'gemini-image';
    if (owner.includes('openai') && outputModalities.includes('image')) return 'openai-image';
    if (source.includes('nanobanana') || source.includes('nano-banana')) return 'gemini-image';
    if (source.includes('gemini') && source.includes('image')) return 'gemini-image';
    if (source.includes('gptimage') || source.includes('gpt-image') || source.includes('dall-e') || (source.includes('image') && (source.includes('openai') || source.includes('gpt-5-image') || source.includes('gpt-4o-image')))) {
        return 'openai-image';
    }
    if (source.includes('minimax') && source.includes('image')) return 'minimax-image';
    if (source.includes('flux')) return 'flux';
    if (source.includes('ideogram')) return 'ideogram';
    if (source.includes('recraft')) return 'recraft';
    if (source.includes('stable-diffusion') || source.includes('sdxl')) return 'stable-diffusion';
    if (source.includes('seedream')) return 'seedream';
    if (source.includes('qwen-image')) return 'qwen-image';
    if (source.includes('hidream')) return 'hidream';
    if (source.includes('imagen')) return 'imagen';
    if (source.includes('midjourney')) return 'midjourney';
    if (source.includes('riverflow')) return 'riverflow';
    return 'generic-image';
}

function gcd(a, b) {
    let x = Math.abs(Number(a) || 0);
    let y = Math.abs(Number(b) || 0);
    if (!x || !y) return 1;
    while (y) {
        const t = y;
        y = x % y;
        x = t;
    }
    return x || 1;
}

function normalizeRatioPair(widthRaw, heightRaw) {
    const width = Number(widthRaw);
    const height = Number(heightRaw);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '';

    const widthDecimals = (String(widthRaw).split('.')[1] || '').length;
    const heightDecimals = (String(heightRaw).split('.')[1] || '').length;
    const precision = Math.min(4, Math.max(widthDecimals, heightDecimals));
    const scale = 10 ** precision;

    const widthInt = Math.round(width * scale);
    const heightInt = Math.round(height * scale);
    if (!Number.isFinite(widthInt) || !Number.isFinite(heightInt) || widthInt <= 0 || heightInt <= 0) return '';

    const d = gcd(widthInt, heightInt);
    return `${Math.round(widthInt / d)}:${Math.round(heightInt / d)}`;
}

function normalizeDimensionToken(token) {
    const value = String(token || '').trim().toLowerCase();
    const match = value.match(/^(\d{2,5})\s*[*x]\s*(\d{2,5})$/);
    if (!match) return null;

    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

    const simplified = `${Math.round(width)}x${Math.round(height)}`;
    const d = gcd(width, height);
    const ratio = `${Math.round(width / d)}:${Math.round(height / d)}`;

    return { width, height, value: simplified, ratio };
}

function collectResolutionTokensFromValue(value, tokens, depth = 0) {
    if (!tokens || depth > 6 || value == null) return;

    if (typeof value === 'string') {
        const token = String(value).trim();
        if (token) tokens.add(token);
        return;
    }

    if (typeof value === 'number') {
        if (Number.isFinite(value) && Math.abs(value) >= 64) {
            tokens.add(String(value));
        }
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            collectResolutionTokensFromValue(item, tokens, depth + 1);
        }
        return;
    }

    if (typeof value !== 'object') return;

    const valueKeys = [
        'enum',
        'enums',
        'options',
        'choices',
        'values',
        'allowed_values',
        'allowedValues',
        'supported_values',
        'supportedValues',
        'oneOf',
        'anyOf',
        'allOf',
        'const',
        'default',
        'items',
    ];

    let extractedByValueKey = false;
    for (const key of valueKeys) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            extractedByValueKey = true;
            collectResolutionTokensFromValue(value[key], tokens, depth + 1);
        }
    }

    for (const [key, nested] of Object.entries(value)) {
        if (typeof nested === 'number' && /(min|max|minimum|maximum|step|default)/i.test(key)) {
            continue;
        }

        if (/^\d{2,5}\s*[*x]\s*\d{2,5}$/i.test(key) ||
            /^\d+\s*k$/i.test(key) ||
            /^\d{3,4}\s*p$/i.test(key) ||
            /^\d{3,5}$/.test(key) ||
            /^\d{1,3}(?:\.\d+)?\s*:\s*\d{1,3}(?:\.\d+)?$/.test(key)) {
            tokens.add(key);
        }

        if (!extractedByValueKey || typeof nested === 'object') {
            collectResolutionTokensFromValue(nested, tokens, depth + 1);
        }
    }
}

function parseModelResolutionMetadata(modelData) {
    const tokens = new Set();

    const valuePaths = [
        'supported_parameters.resolutions',
        'supported_parameters.resolution',
        'supported_parameters.image_sizes',
        'supported_parameters.image_size_tiers',
        'supported_parameters.sizes',
        'supported_parameters.aspect_ratios',
        'supported_parameters.aspect_ratio',
        'supportedParameters.resolutions',
        'supportedParameters.resolution',
        'supportedParameters.imageSizes',
        'supportedParameters.imageSizeTiers',
        'supportedParameters.sizes',
        'supportedParameters.aspectRatios',
        'supportedParameters.aspectRatio',
        'per_request_limits.resolutions',
        'per_request_limits.image_sizes',
        'per_request_limits.aspect_ratios',
        'capabilities.resolutions',
        'capabilities.image_sizes',
        'capabilities.image_size_tiers',
        'capabilities.aspect_ratios',
        'supports.resolutions',
        'supports.image_sizes',
        'supports.image_size_tiers',
        'supports.aspect_ratios',
        'image_config.resolutions',
        'image_config.image_sizes',
        'image_config.aspect_ratios',
        'imageConfig.resolutions',
        'imageConfig.imageSizes',
        'imageConfig.aspectRatios',
    ];
    for (const path of valuePaths) {
        const value = readNestedField(modelData, path);
        collectResolutionTokensFromValue(value, tokens);
    }

    const objectKeyPaths = [
        'pricing.per_image',
        'pricing.perImage',
    ];
    for (const path of objectKeyPaths) {
        const value = readNestedField(modelData, path);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const key of Object.keys(value)) {
                const token = String(key || '').trim();
                if (token) tokens.add(token);
            }
        }
    }

    // Fallback extraction from free-text metadata when explicit fields are missing.
    const textSources = [
        modelData?.id,
        modelData?.name,
        modelData?.displayName,
        modelData?.description,
        modelData?.owned_by,
        modelData?.ownedBy,
        ...(Array.isArray(modelData?.tags) ? modelData.tags : []),
    ].map(v => String(v || ''));

    for (const text of textSources) {
        if (!text) continue;

        const tierMatches = text.match(/\b(\d{1,2})\s*k\b/ig) || [];
        for (const match of tierMatches) {
            tokens.add(String(match).replace(/\s+/g, '').toUpperCase());
        }

        const ratioMatches = text.match(/\b\d{1,3}(?:\.\d+)?\s*:\s*\d{1,3}(?:\.\d+)?\b/g) || [];
        for (const match of ratioMatches) {
            tokens.add(String(match).replace(/\s+/g, ''));
        }

        const dimMatches = text.match(/\b\d{3,5}\s*[*x]\s*\d{3,5}\b/ig) || [];
        for (const match of dimMatches) {
            tokens.add(String(match).replace(/\s+/g, ''));
        }

        const pMatches = text.match(/\b\d{3,4}\s*p\b/ig) || [];
        for (const match of pMatches) {
            tokens.add(String(match).replace(/\s+/g, '').toLowerCase());
        }
    }

    const tierSizes = [];
    const dimensionSizes = [];
    const aspectRatios = [];

    for (const tokenRaw of tokens) {
        const token = String(tokenRaw).trim();
        const tokenLower = token.toLowerCase();
        if (!token || ['auto', 'default', 'native', 'original'].includes(tokenLower)) continue;

        const tierMatch = token.match(/^(\d+)\s*k$/i);
        if (tierMatch) {
            const normalizedTier = `${Number(tierMatch[1])}K`;
            if (!tierSizes.includes(normalizedTier)) tierSizes.push(normalizedTier);
            continue;
        }

        const pMatch = token.match(/^(\d{3,4})\s*p$/i);
        if (pMatch) {
            const height = Number(pMatch[1]);
            if (Number.isFinite(height) && height > 0) {
                const width = Math.round((height * 16) / 9);
                const normalizedDim = normalizeDimensionToken(`${width}x${height}`);
                if (normalizedDim) {
                    if (!dimensionSizes.includes(normalizedDim.value)) dimensionSizes.push(normalizedDim.value);
                    if (!aspectRatios.includes(normalizedDim.ratio)) aspectRatios.push(normalizedDim.ratio);
                }
            }
            continue;
        }

        if (/^\d{3,5}$/.test(token)) {
            const square = Number(token);
            const normalizedDim = normalizeDimensionToken(`${square}x${square}`);
            if (normalizedDim) {
                if (!dimensionSizes.includes(normalizedDim.value)) dimensionSizes.push(normalizedDim.value);
                if (!aspectRatios.includes(normalizedDim.ratio)) aspectRatios.push(normalizedDim.ratio);
            }
            continue;
        }

        const ratioToken = normalizeAspectRatioValue(token);
        if (ratioToken) {
            if (!aspectRatios.includes(ratioToken)) aspectRatios.push(ratioToken);
            continue;
        }

        const dim = normalizeDimensionToken(token);
        if (dim) {
            if (!dimensionSizes.includes(dim.value)) dimensionSizes.push(dim.value);
            if (!aspectRatios.includes(dim.ratio)) aspectRatios.push(dim.ratio);
        }
    }

    tierSizes.sort((a, b) => Number(a.replace(/k/i, '')) - Number(b.replace(/k/i, '')));
    dimensionSizes.sort((a, b) => {
        const [aw, ah] = a.split('x').map(Number);
        const [bw, bh] = b.split('x').map(Number);
        return (aw * ah) - (bw * bh);
    });

    return {
        tierSizes,
        dimensionSizes,
        aspectRatios,
    };
}

function inferMaxReferenceImages(modelId, modelData = null) {
    const id = String(modelId || '').toLowerCase();

    // Try provider metadata first when available.
    const numericPaths = [
        'max_input_images',
        'supported_parameters.max_images',
        'supportedParameters.maxImages',
        'capabilities.max_input_images',
        'supports.max_input_images',
        'limits.max_input_images',
        'per_request_limits.max_input_images',
        'per_request_limits.max_images',
    ];
    for (const path of numericPaths) {
        const value = Number(readNestedField(modelData, path));
        if (Number.isFinite(value) && value > 0) {
            return Math.floor(value);
        }
    }

    // Known limits by model family/version.
    if (isGemini25FlashImageModel(id)) return 3;
    if (isGemini3ProImagePreviewModel(id)) return 14;
    if (id.includes('gemini') && id.includes('image')) return 5;

    return null;
}

function getModelRuntimeProfile(modelOrId, providerId = null) {
    const settings = extension_settings[extensionName] || defaultSettings;
    const activeProviderId = providerId || getProviderConfig(settings).id;
    const modelId = normalizeModelIdentifier(modelOrId);
    const modelDataFromArg = (typeof modelOrId === 'object' && modelOrId)
        ? modelOrId
        : findCachedModelById(modelId);
    let modelData = modelDataFromArg;
    const id = modelId.toLowerCase();

    // Some providers use opaque IDs; fall back to the selected option text for family inference.
    if (!modelData && id && typeof $ === 'function') {
        const selectedOption = $('#nig_model option:selected');
        const selectedValue = String(selectedOption.val() || '').trim().toLowerCase();
        if (selectedOption.length && selectedValue === id) {
            modelData = { name: String(selectedOption.text() || '') };
        }
    }

    const inputModalities = getModelModalities(modelData, 'input');
    const outputModalities = getModelModalities(modelData, 'output');
    const supportedParameters = getModelSupportedParameters(modelData);
    const resolutionMeta = parseModelResolutionMetadata(modelData);
    const features = Array.isArray(modelData?.features)
        ? modelData.features.map(f => String(f).toLowerCase())
        : [];
    const family = inferModelFamily(modelId, modelData);
    const preset = getModelCapabilityPreset(modelId, family, activeProviderId);
    const presetImageSizes = Array.isArray(preset?.imageSizes) ? preset.imageSizes : [];
    const presetAspectRatios = Array.isArray(preset?.aspectRatios) ? preset.aspectRatios : [];
    const presetHasTierSizes = presetImageSizes.some(isTierImageSizeValue);
    const presetHasDimensionSizes = presetImageSizes.some(isDimensionImageSizeValue);

    const supportsImageInputFromMetadata = (
        modelData?._supportsImageInput === true ||
        inputModalities.includes('image') ||
        modelData?.capabilities?.image_to_image === true ||
        modelData?.capabilities?.image_input === true ||
        modelData?.supports?.image_to_image === true ||
        modelData?.supports?.image_input === true
    );

    const supportsImageInputFromHeuristics = (
        MODELS_WITH_IMAGE_INPUT.some(m => id.includes(m.toLowerCase())) ||
        ['image-to-image', 'image_to_image', 'img2img', 'kontext', 'redux', 'canny', 'depth', 'gpt-image', 'gpt-5-image', 'gpt-4o-image', 'riverflow']
            .some(h => id.includes(h)) ||
        family === 'gemini-image' ||
        features.some(f => /image_to_image|image-input|img2img/.test(f))
    );

    const supportsImageInput = supportsImageInputFromMetadata || supportsImageInputFromHeuristics;

    // This controls visibility of model-specific image size/resolution options.
    const supportsTieredImageSize = (
        resolutionMeta.tierSizes.length > 0 ||
        resolutionMeta.dimensionSizes.length > 0 ||
        presetHasTierSizes ||
        presetHasDimensionSizes ||
        modelData?._supportsImageSizeControl === true ||
        modelData?.capabilities?.image_size === true ||
        modelData?.supports?.image_size === true ||
        supportedParameters.includes('image_size') ||
        supportedParameters.includes('size') ||
        supportedParameters.includes('resolutions') ||
        features.some(f => /image[_-]?size|size[_-]?tier/.test(f)) ||
        isGemini3ProImagePreviewModel(id)
    );

    const prefersDimensionSize = (
        resolutionMeta.dimensionSizes.length > 0 ||
        presetHasDimensionSizes ||
        family === 'openai-image' ||
        supportedParameters.includes('size') ||
        supportedParameters.includes('resolutions')
    );

    const transport = (() => {
        if (activeProviderId === 'linkapi' && family === 'gemini-image') return 'linkapi-gemini-native';
        if (activeProviderId === 'openrouter' && supportsImageInput && (family === 'openai-image' || supportedParameters.includes('input_image'))) {
            return 'openrouter-responses';
        }
        if (activeProviderId === 'openrouter') return 'openrouter-chat';
        if (activeProviderId === 'pollinations') return 'pollinations-url';
        return 'default';
    })();

    return {
        modelId,
        providerId: activeProviderId,
        family,
        transport,
        inputModalities,
        outputModalities,
        supportedParameters,
        supportsImageInput,
        supportsTieredImageSize,
        prefersDimensionSize,
        tierImageSizes: resolutionMeta.tierSizes,
        dimensionSizes: resolutionMeta.dimensionSizes,
        resolutionAspectRatios: resolutionMeta.aspectRatios,
        presetAspectRatios,
        presetImageSizes,
        maxReferenceImages: inferMaxReferenceImages(modelId, modelData),
        modelData,
    };
}

function normalizeAspectRatioValue(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';

    const aliases = {
        square: '1:1',
        landscape: '16:9',
        portrait: '9:16',
    };
    if (aliases[raw]) return aliases[raw];

    const colonMatch = raw.match(/^(\d{1,3}(?:\.\d+)?)\s*:\s*(\d{1,3}(?:\.\d+)?)$/);
    if (colonMatch) return normalizeRatioPair(colonMatch[1], colonMatch[2]);

    const xMatch = raw.match(/^(\d{1,3}(?:\.\d+)?)\s*[x/]\s*(\d{1,3}(?:\.\d+)?)$/);
    if (xMatch) return normalizeRatioPair(xMatch[1], xMatch[2]);

    return '';
}

function normalizeImageSizeTierValue(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return '';
    if (/^\d+K$/.test(raw)) return raw;
    if (IMAGE_SIZE_TIER_OPTIONS.includes(raw)) return raw;

    if (raw === '1024' || raw === '1') return '1K';
    if (raw === '2048' || raw === '2') return '2K';
    if (raw === '4096' || raw === '4') return '4K';
    if (raw === '8192' || raw === '8') return '8K';
    return '';
}

function normalizeImageDimensionValue(value) {
    const dim = normalizeDimensionToken(value);
    return dim ? dim.value : '';
}

function normalizeImageSizeOptionValue(value) {
    const tier = normalizeImageSizeTierValue(value);
    if (tier) return tier;
    return normalizeImageDimensionValue(value);
}

function isTierImageSizeValue(value) {
    return /^\d+K$/i.test(String(value || '').trim());
}

function isDimensionImageSizeValue(value) {
    return !!normalizeImageDimensionValue(value);
}

function extractStringArrayByPaths(source, paths) {
    if (!source || !Array.isArray(paths)) return [];
    for (const path of paths) {
        const value = readNestedField(source, path);
        if (Array.isArray(value) && value.length > 0) {
            return value.map(v => String(v)).filter(Boolean);
        }
    }
    return [];
}

function getModelAspectRatioOptions(profile) {
    const rawAspectRatios = extractStringArrayByPaths(profile?.modelData, [
        'supported_parameters.aspect_ratios',
        'supported_parameters.supported_aspect_ratios',
        'supportedParameters.aspectRatios',
        'capabilities.aspect_ratios',
        'capabilities.supported_aspect_ratios',
        'supports.aspect_ratios',
        'supports.supported_aspect_ratios',
        'image_config.aspect_ratios',
        'imageConfig.aspectRatios',
    ]);

    const normalizedFromMetadata = [...new Set(rawAspectRatios
        .map(normalizeAspectRatioValue)
        .filter(Boolean))];
    const normalizedFromResolutions = [...new Set((profile?.resolutionAspectRatios || [])
        .map(normalizeAspectRatioValue)
        .filter(Boolean))];
    const normalizedFromPreset = [...new Set((profile?.presetAspectRatios || [])
        .map(normalizeAspectRatioValue)
        .filter(Boolean))];
    const merged = [...new Set([
        ...normalizedFromMetadata,
        ...normalizedFromResolutions,
        ...normalizedFromPreset,
    ])];

    if (merged.length > 0) return merged;

    if (profile?.providerId === 'pollinations') return [...POLLINATIONS_ASPECT_RATIO_OPTIONS];
    if (profile?.family === 'gemini-image') return [...GEMINI_ASPECT_RATIO_OPTIONS];
    if (profile?.family === 'openai-image') return [...OPENAI_IMAGE_ASPECT_RATIO_OPTIONS];
    return [...DEFAULT_ASPECT_RATIO_OPTIONS];
}

function getModelImageSizeOptions(profile) {
    if (profile?.providerId === 'pollinations') {
        return [];
    }

    if (Array.isArray(profile?.tierImageSizes) && profile.tierImageSizes.length > 0) {
        return [...profile.tierImageSizes];
    }
    if (Array.isArray(profile?.dimensionSizes) && profile.dimensionSizes.length > 0) {
        return [...profile.dimensionSizes];
    }
    if (!profile?.supportsTieredImageSize) return [];

    const rawSizes = extractStringArrayByPaths(profile?.modelData, [
        'supported_parameters.image_sizes',
        'supported_parameters.image_size_tiers',
        'supportedParameters.imageSizes',
        'capabilities.image_sizes',
        'capabilities.image_size_tiers',
        'supports.image_sizes',
        'supports.image_size_tiers',
        'image_config.image_sizes',
        'image_config.image_size_tiers',
        'imageConfig.imageSizes',
    ]);

    const normalized = [...new Set(rawSizes
        .map(normalizeImageSizeOptionValue)
        .filter(Boolean))];

    if (normalized.length > 0) return normalized;

    const presetSizes = Array.isArray(profile?.presetImageSizes)
        ? [...new Set(profile.presetImageSizes
            .map(normalizeImageSizeOptionValue)
            .filter(Boolean))]
        : [];
    if (presetSizes.length > 0) return presetSizes;

    // Provider-agnostic fallbacks when APIs don't expose explicit image-size metadata.
    if (profile?.family === 'gemini-image') return ['1K', '2K', '4K'];
    if (profile?.family === 'openai-image') return ['1024x1024', '1536x1024', '1024x1536'];
    if (profile?.family === 'minimax-image') return [...MINIMAX_IMAGE_DIMENSION_OPTIONS];
    if (profile?.providerId !== 'pollinations') return [...COMMON_IMAGE_DIMENSION_OPTIONS];

    return [];
}

function getEffectiveAspectRatioForModel(aspectRatio, modelOrId) {
    const profile = getModelRuntimeProfile(modelOrId);
    const available = getModelAspectRatioOptions(profile);
    if (available.length === 0) return defaultSettings.aspect_ratio;

    const normalized = normalizeAspectRatioValue(aspectRatio) || defaultSettings.aspect_ratio;
    return available.includes(normalized) ? normalized : available[0];
}

function getAspectRatioFloat(aspectRatio) {
    const normalized = normalizeAspectRatioValue(aspectRatio);
    if (!normalized) return null;
    const [w, h] = normalized.split(':').map(Number);
    if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return null;
    return w / h;
}

function getBestDimensionSizeForAspectRatio(aspectRatio, dimensionSizes) {
    if (!Array.isArray(dimensionSizes) || dimensionSizes.length === 0) return null;

    const targetRatio = getAspectRatioFloat(aspectRatio);
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const value of dimensionSizes) {
        const dim = normalizeDimensionToken(value);
        if (!dim) continue;

        const ratio = dim.width / dim.height;
        const diff = targetRatio === null ? 0 : Math.abs(ratio - targetRatio);
        const area = dim.width * dim.height;
        const score = diff * 1e9 - area; // prefer closest ratio, then larger size

        if (score < bestScore) {
            bestScore = score;
            best = dim.value;
        }
    }

    return best;
}

function getModelRequestSize(profile, aspectRatio) {
    const fallback = getImageSize(aspectRatio);
    if (!profile || !profile.prefersDimensionSize) return fallback;

    const selected = getBestDimensionSizeForAspectRatio(aspectRatio, profile.dimensionSizes || []);
    return selected || fallback;
}

function getEffectiveModelSizeOption(profile, requestedSize, aspectRatio) {
    const options = getModelImageSizeOptions(profile);
    if (options.length === 0) return '';

    const normalizedRequested = normalizeImageSizeOptionValue(requestedSize);
    if (normalizedRequested && options.includes(normalizedRequested)) {
        return normalizedRequested;
    }

    if (Array.isArray(profile?.dimensionSizes) && profile.dimensionSizes.length > 0) {
        return getBestDimensionSizeForAspectRatio(aspectRatio, profile.dimensionSizes) || options[0];
    }

    const defaultTier = normalizeImageSizeTierValue(defaultSettings.image_size);
    if (defaultTier && options.includes(defaultTier)) {
        return defaultTier;
    }

    return options[0];
}

function updateGenerationControlOptions(modelId = null) {
    const settings = extension_settings[extensionName];
    const hasExplicitModel = modelId !== null && modelId !== undefined;
    const selectedModel = hasExplicitModel ? String(modelId || '') : settings.model;
    const profile = getModelRuntimeProfile(selectedModel);
    const availableRatios = getModelAspectRatioOptions(profile);

    const ratioSelect = $('#nig_aspect_ratio');
    if (ratioSelect.length) {
        const optionsHtml = availableRatios
            .map(ratio => `<option value="${ratio}">${ASPECT_RATIO_LABELS[ratio] || ratio}</option>`)
            .join('');
        ratioSelect.html(optionsHtml);

        const effectiveRatio = getEffectiveAspectRatioForModel(settings.aspect_ratio, selectedModel);
        ratioSelect.val(effectiveRatio);

        if (settings.aspect_ratio !== effectiveRatio) {
            settings.aspect_ratio = effectiveRatio;
            saveSettingsDebounced();
        }
    }

    const sizeField = $('#nig_image_size_field');
    const sizeSelect = $('#nig_image_size');
    if (!sizeField.length || !sizeSelect.length) {
        console.log(`[${extensionName}] Model controls updated for "${selectedModel || '(none)'}": ratios=${availableRatios.join(',') || 'none'} sizes=field-missing`);
        return;
    }

    const availableSizes = getModelImageSizeOptions(profile);
    if (availableSizes.length === 0) {
        sizeField.hide();
        console.log(`[${extensionName}] Model controls updated for "${selectedModel || '(none)'}": ratios=${availableRatios.join(',') || 'none'} sizes=none`);
        return;
    }

    sizeField.show();
    const sizeHtml = availableSizes
        .map(size => `<option value="${size}">${size}</option>`)
        .join('');
    sizeSelect.html(sizeHtml);

    const ratioForSize = settings.aspect_ratio || defaultSettings.aspect_ratio;
    const effectiveSize = getEffectiveModelSizeOption(profile, settings.image_size, ratioForSize);
    sizeSelect.val(effectiveSize);

    if (settings.image_size !== effectiveSize) {
        settings.image_size = effectiveSize;
        saveSettingsDebounced();
    }

    console.log(`[${extensionName}] Model controls updated for "${selectedModel || '(none)'}": ratios=${availableRatios.join(',') || 'none'} sizes=${availableSizes.join(',') || 'none'}`);
}

function supportsImageInput(modelOrId) {
    const profile = getModelRuntimeProfile(modelOrId);
    return profile.supportsImageInput === true;
}

function supportsImageSizeControl(modelId, modelData = null) {
    const profile = getModelRuntimeProfile(modelData || modelId);
    return profile.supportsTieredImageSize === true;
}

function updateImageSizeControlVisibility(modelId = null) {
    updateGenerationControlOptions(modelId);
}

function updateModelInfo() {
    const model = extension_settings[extensionName].model;
    const infoEl = $('#nig_model_info');

    // Check cached models first for accurate capability info
    const modelData = findCachedModelById(model);
    const profile = getModelRuntimeProfile(modelData || model);

    if (profile.supportsImageInput) {
        const extras = [];
        if (Number.isFinite(profile.maxReferenceImages) && profile.maxReferenceImages > 0) {
            extras.push(`max ${profile.maxReferenceImages} references`);
        }
        if (getModelImageSizeOptions(profile).length > 0) {
            extras.push('supports model-specific size/resolution options');
        }
        const extraText = extras.length > 0 ? `<br><small>${extras.join(' • ')}</small>` : '';
        infoEl.html(`✅ This model supports reference images${extraText}`).css('color', '#5cb85c');
    } else {
        infoEl.html('⚠️ This model does NOT support reference images').css('color', '#f0ad4e');
    }

    updateImageSizeControlVisibility(model);
}

function getProviderConfig(settings) {
    const provider = settings.provider || 'nano-gpt';
    if (provider === 'nano-gpt') {
        return {
            id: 'nano-gpt',
            name: 'NanoGPT',
            modelsUrl: 'https://nano-gpt.com/api/v1/image-models?detailed=true',
            modelsTestUrl: 'https://nano-gpt.com/api/v1/models',
            chatUrl: 'https://nano-gpt.com/api/v1/chat/completions',
            defaultApiEndpoint: 'https://nano-gpt.com/v1/images/generations',
            supportsGzipModelsResponse: true,
        };
    } else if (provider === 'openrouter') {
        return {
            id: 'openrouter',
            name: 'OpenRouter',
            modelsUrl: 'https://openrouter.ai/api/v1/models',
            modelsTestUrl: 'https://openrouter.ai/api/v1/models',
            chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
            defaultApiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
            supportsGzipModelsResponse: false,
        };
    } else if (provider === 'linkapi') {
        return {
            id: 'linkapi',
            name: 'LinkAPI.ai',
            modelsUrl: 'https://api.linkapi.ai/v1beta/models',  // Gemini format includes image models
            modelsTestUrl: 'https://api.linkapi.ai/v1/models',
            chatUrl: 'https://api.linkapi.ai/v1/chat/completions',
            defaultApiEndpoint: 'https://api.linkapi.ai/v1/images/generations',
            supportsGzipModelsResponse: false,
        };
    } else if (provider === 'pollinations') {
        return {
            id: 'pollinations',
            name: 'Pollinations.ai',
            modelsUrl: 'https://gen.pollinations.ai/image/models',
            modelsTestUrl: 'https://gen.pollinations.ai/text/models',
            chatUrl: 'https://text.pollinations.ai/openai/v1/chat/completions',
            defaultApiEndpoint: 'https://gen.pollinations.ai/image/',
            supportsGzipModelsResponse: false,
            noApiKeyRequired: false,  // API key required
        };
    } else {
        return {
            id: 'custom',
            name: 'Custom',
            modelsUrl: null,
            modelsTestUrl: null,
            chatUrl: null,
            defaultApiEndpoint: settings.api_endpoint || '',
            supportsGzipModelsResponse: false,
        };
    }
}

async function fetchModelsFromAPI(silent = false) {
    const settings = extension_settings[extensionName];
    const providerConfig = getProviderConfig(settings);
    const modelsUrl = providerConfig.modelsUrl || settings.api_endpoint;
    addRuntimeLog('info', 'Fetching image models', {
        provider: providerConfig.id,
        modelsUrl,
        silent,
    });

    const btn = $('#nig_fetch_models_btn');
    btn.find('i').removeClass('fa-rotate').addClass('fa-spinner fa-spin');

    try {
        // Add auth if available (enables user-specific pricing)
        const headers = {
            'Accept': 'application/json',
        };
        if (getCurrentApiKey()) {
            headers['Authorization'] = `Bearer ${getCurrentApiKey()}`;
        }

        if (!modelsUrl) {
            if (!silent) {
                toastr.info('Model listing not available for selected provider. Please set the model manually.', 'Pawtrait');
            }
            addRuntimeLog('warn', 'Image model fetch skipped: no URL', {
                provider: providerConfig.id,
            });
            return;
        }

        const response = await fetch(modelsUrl, {
            method: 'GET',
            headers: headers,
        });

        console.log(`[${extensionName}] Response status:`, response.status);
        addRuntimeLog('debug', 'Image model response status', {
            provider: providerConfig.id,
            status: response.status,
            ok: response.ok,
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }

        // Get raw bytes
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        let jsonText;

        // Check if response is gzip compressed (starts with 0x1f 0x8b)
        if (providerConfig.supportsGzipModelsResponse && bytes[0] === 0x1f && bytes[1] === 0x8b) {
            console.log(`[${extensionName}] Response is gzip compressed, decompressing...`);

            // Use DecompressionStream API (modern browsers)
            if (typeof DecompressionStream !== 'undefined') {
                const ds = new DecompressionStream('gzip');
                const decompressedStream = new Response(arrayBuffer).body.pipeThrough(ds);
                jsonText = await new Response(decompressedStream).text();
            } else {
                // Fallback: try using pako if available
                if (typeof pako !== 'undefined') {
                    const decompressed = pako.ungzip(bytes, { to: 'string' });
                    jsonText = decompressed;
                } else {
                    throw new Error('Cannot decompress gzip response - no decompression library available');
                }
            }
        } else {
            // Not compressed, decode as UTF-8
            jsonText = new TextDecoder().decode(bytes);
        }

        console.log(`[${extensionName}] Decompressed response (first 200 chars):`, jsonText.substring(0, 200));

        const data = JSON.parse(jsonText);
        console.log(`[${extensionName}] Image Models API response:`, data);
        addRuntimeLog('debug', 'Image model raw payload parsed', {
            provider: providerConfig.id,
            payloadShape: {
                hasDataArray: Array.isArray(data?.data),
                hasModelsArray: Array.isArray(data?.models),
                isArray: Array.isArray(data),
            },
        });

        // Handle different response formats:
        // OpenAI format: { data: [...] }
        // Gemini format: { models: [...] } or direct array
        let imageModels = data.data || data.models || (Array.isArray(data) ? data : []);

        // For LinkAPI (using Gemini format), normalize model objects and filter for image models
        if (providerConfig.id === 'linkapi') {
            // Gemini format models have 'name' field like "models/gemini-2.5-flash-image"
            // Normalize to have 'id' field for consistency
            imageModels = imageModels.map(m => ({
                ...m,
                id: m.id || (m.name ? m.name.replace('models/', '') : ''),
                name: m.displayName || m.name?.replace('models/', '') || m.id || ''
            }));

            imageModels = filterLinkAPIImageModels(imageModels);
            console.log(`[${extensionName}] Filtered to ${imageModels.length} image generation models for LinkAPI`);
        }

        // For OpenRouter, filter for image generation models
        if (providerConfig.id === 'openrouter') {
            imageModels = filterOpenRouterImageModels(imageModels);
            console.log(`[${extensionName}] Filtered to ${imageModels.length} image generation models for OpenRouter`);
        }

        // For Pollinations, filter for image models only (exclude video models)
        if (providerConfig.id === 'pollinations') {
            imageModels = filterPollinationsImageModels(imageModels);
            console.log(`[${extensionName}] Filtered to ${imageModels.length} image generation models for Pollinations`);
        }
        addRuntimeLog('info', 'Image models fetched', {
            provider: providerConfig.id,
            count: imageModels.length,
        });

        if (imageModels.length > 0) {
            cachedModels = imageModels;
            updateModelDropdown(imageModels);
            if (!silent) {
                toastr.success(`Found ${imageModels.length} image models`, 'Pawtrait');
            }
        } else {
            if (!silent) {
                toastr.info('No image models found in API response.', 'Pawtrait');
            }
        }

    } catch (error) {
        console.error(`[${extensionName}] Error fetching models:`, error);
        addRuntimeLog('error', 'Failed to fetch image models', {
            provider: providerConfig.id,
            modelsUrl,
            error,
        });
        if (!silent) {
            toastr.error(`Failed to fetch models: ${error.message}`, 'Pawtrait');
        }
    } finally {
        btn.find('i').removeClass('fa-spinner fa-spin').addClass('fa-rotate');
    }
}

/**
 * Filter LinkAPI models to only include image generation capable models
 * Detected patterns from LinkAPI: gemini-*-image*, nai-diffusion-*, veo-*-generate-*
 */
function filterLinkAPIImageModels(models) {
    console.log(`[${extensionName}] Filtering ${models.length} models for image generation capability...`);

    const filtered = models.filter(model => {
        const id = (model.id || model.name || '').toString().toLowerCase();

        // Check for image generation patterns based on LinkAPI's naming
        const isImageModel = (
            id.includes('-image') ||           // gemini-2.5-flash-image, gemini-3-pro-image-preview
            id.includes('diffusion') ||        // nai-diffusion-4-5-full
            (id.startsWith('veo-') && id.includes('generate')) ||  // veo-*-generate-*
            id.includes('dall-e') ||           // dall-e-2, dall-e-3
            id.includes('gpt-image') ||        // gpt-image-1
            id.includes('stable-diffusion') || // stable-diffusion models
            id.includes('flux') ||             // flux models
            id.includes('midjourney') ||       // midjourney
            id.includes('ideogram') ||         // ideogram
            id.includes('recraft')             // recraft
        );

        if (isImageModel) {
            // Determine if model supports reference images (image input)
            const supportsInput = (
                id.includes('gpt-image') ||
                (id.includes('flux') && id.includes('kontext')) ||
                (id.includes('gemini') && id.includes('image'))  // Gemini image models may support input
            );
            model._supportsImageInput = supportsInput;
            console.log(`[${extensionName}] Found image model: ${id} (supports input: ${supportsInput})`);
        }

        return isImageModel;
    });

    // If no models matched from API, the image models might not be in /v1/models
    if (filtered.length === 0 && models.length > 0) {
        const sampleIds = models.slice(0, 10).map(m => m.id || m.name).join(', ');
        console.log(`[${extensionName}] No image models in API response. Sample IDs: ${sampleIds}`);
        console.log(`[${extensionName}] LinkAPI image models may need to be entered manually or fetched from a different endpoint.`);
    }

    return filtered;
}

/**
 * Filter OpenRouter models to only include image generation capable models
 * OpenRouter models have architecture.output_modalities that includes "image"
 */
function filterOpenRouterImageModels(models) {
    console.log(`[${extensionName}] Filtering ${models.length} OpenRouter models for image generation...`);

    const filtered = models.filter(model => {
        const id = (model.id || model.name || '').toString().toLowerCase();

        // Exclude router/auto models - they don't give predictable results
        if (id.includes('/auto') || id.includes('/free') || id.includes('router')) {
            return false;
        }

        // Check output_modalities field (OpenRouter's way of indicating image generation)
        const outputModalities = model.architecture?.output_modalities || model.output_modalities || [];
        const hasImageOutput = Array.isArray(outputModalities) && outputModalities.includes('image');

        // Also check by name patterns as fallback
        const isImageModelByName = (
            id.includes('dall-e') ||
            id.includes('gpt-image') ||
            id.includes('flux') ||
            id.includes('stable-diffusion') ||
            id.includes('sdxl') ||
            id.includes('midjourney') ||
            id.includes('ideogram') ||
            id.includes('recraft') ||
            id.includes('playground') ||
            id.includes('kandinsky') ||
            id.includes('imagen') ||
            id.includes('riverflow') ||
            (id.includes('gemini') && id.includes('image'))
        );

        const isImageModel = hasImageOutput || isImageModelByName;

        if (isImageModel) {
            // Check input modalities for image-to-image support
            const inputModalities = model.architecture?.input_modalities || model.input_modalities || [];
            const hasImageInput = Array.isArray(inputModalities) && inputModalities.includes('image');

            // Also check by name patterns
            const supportsInputByName = (
                id.includes('gpt-image') ||
                (id.includes('flux') && (id.includes('kontext') || id.includes('redux') || id.includes('canny') || id.includes('depth') || id.includes('flex'))) ||
                (id.includes('gemini') && id.includes('image')) ||
                id.includes('img2img') ||
                id.includes('image-to-image') ||
                id.includes('riverflow')
            );

            model._supportsImageInput = hasImageInput || supportsInputByName;
            console.log(`[${extensionName}] Found OpenRouter image model: ${id} (supports input: ${model._supportsImageInput})`);
        }

        return isImageModel;
    });

    if (filtered.length === 0 && models.length > 0) {
        const sampleIds = models.slice(0, 10).map(m => m.id || m.name).join(', ');
        console.log(`[${extensionName}] No image models found in OpenRouter. Sample IDs: ${sampleIds}`);
    }

    return filtered;
}

/**
 * Filter Pollinations models to only include image generation models (exclude video)
 * Pollinations API returns models with output_modalities field
 */
function filterPollinationsImageModels(models) {
    console.log(`[${extensionName}] Filtering ${models.length} Pollinations models for image generation...`);

    const filtered = models.filter(model => {
        // Check output_modalities - only include models that output images (not video)
        const outputModalities = model.output_modalities || [];
        const hasImageOutput = Array.isArray(outputModalities) && outputModalities.includes('image');
        const hasVideoOutput = Array.isArray(outputModalities) && outputModalities.includes('video');

        // Only include image models, exclude video-only models
        if (!hasImageOutput || hasVideoOutput) {
            return false;
        }

        const id = (model.name || model.id || '').toString().toLowerCase();

        // Check input_modalities for image-to-image support
        const inputModalities = model.input_modalities || [];
        const hasImageInput = Array.isArray(inputModalities) && inputModalities.includes('image');

        model._supportsImageInput = hasImageInput;
        model._isPaidModel = model.paid_only === true;
        model.id = model.name || model.id;  // Normalize to use 'name' as 'id' for Pollinations

        console.log(`[${extensionName}] Found Pollinations image model: ${id} (supports input: ${hasImageInput}, paid: ${model._isPaidModel})`);
        return true;
    });

    // Sort to put paid/premium models first
    filtered.sort((a, b) => {
        // Paid models first
        if (a._isPaidModel && !b._isPaidModel) return -1;
        if (!a._isPaidModel && b._isPaidModel) return 1;
        return 0;
    });

    if (filtered.length === 0 && models.length > 0) {
        const sampleIds = models.slice(0, 10).map(m => m.name || m.id).join(', ');
        console.log(`[${extensionName}] No image models found in Pollinations. Sample IDs: ${sampleIds}`);
    }

    return filtered;
}

function updateModelDropdown(models) {
    const select = $('#nig_model');
    const currentValue = select.val();
    const settings = extension_settings[extensionName];
    const providerConfig = getProviderConfig(settings);

    // Group models by whether they support image-to-image (reference images)
    const withImageInput = [];
    const withoutImageInput = [];

    for (const model of models) {
        const id = model.id || model.name || '';
        const name = model.name || id;

        // Get pricing - different providers have different formats
        let priceStr = '';
        let priceNum = Infinity; // For sorting

        // NanoGPT format: pricing.per_image with resolution-based pricing
        if (model.pricing?.per_image) {
            const prices = model.pricing.per_image;
            if (typeof prices === 'object') {
                const price = prices['1024x1024'] || prices['1024x768'] || Object.values(prices)[0];
                if (price) {
                    priceStr = `$${Number(price).toFixed(4)}`;
                    priceNum = Number(price);
                }
            } else if (typeof prices === 'number' || typeof prices === 'string') {
                const price = Number(prices);
                if (price > 0) {
                    priceStr = `$${price.toFixed(4)}`;
                    priceNum = price;
                }
            }
        }
        // Pollinations format: pricing.completionImageTokens (in pollen currency)
        else if (model.pricing?.completionImageTokens) {
            const price = Number(model.pricing.completionImageTokens);
            if (price > 0) {
                // Show as pollen cost - multiply by 1000 for readability
                priceStr = `${(price * 1000).toFixed(2)} pollen`;
                priceNum = price;
            }
        }
        // OpenRouter/OpenAI format: pricing.prompt and pricing.completion (per token as strings)
        else if (model.pricing) {
            const completionPrice = parseFloat(model.pricing.completion);
            if (!isNaN(completionPrice) && completionPrice > 0) {
                // Show per-1k tokens for comparison
                const estimatedPrice = completionPrice * 1000;
                priceStr = `$${estimatedPrice.toFixed(4)}/1k`;
                priceNum = estimatedPrice;
            }
        }

        // Add paid indicator for Pollinations paid models
        let displayName = name;
        if (model._isPaidModel) {
            displayName = `💎 ${name}`;  // Diamond for premium/paid models (Pollinations style)
        }
        if (priceStr) {
            displayName = `${displayName} (${priceStr})`;
        }

        // Check capabilities/heuristics for image input support
        const supportsImg2Img = supportsImageInput(model);

        const entry = { id, displayName, name, price: priceNum, isPaid: model._isPaidModel };

        if (supportsImg2Img) {
            withImageInput.push(entry);
        } else {
            withoutImageInput.push(entry);
        }
    }

    // Sort by price (cheapest first), then by name
    const sortByPrice = (a, b) => {
        if (a.price !== b.price) return a.price - b.price;
        return a.name.localeCompare(b.name);
    };

    withImageInput.sort(sortByPrice);
    withoutImageInput.sort(sortByPrice);

    select.empty();

    if (withImageInput.length > 0) {
        const group1 = $('<optgroup label="⭐ Supports Reference Images (by price)"></optgroup>');
        for (const m of withImageInput) {
            group1.append(`<option value="${m.id}">${m.displayName}</option>`);
        }
        select.append(group1);
    }

    if (withoutImageInput.length > 0) {
        const group2 = $('<optgroup label="📦 Text-to-Image Only (by price)"></optgroup>');
        for (const m of withoutImageInput) {
            group2.append(`<option value="${m.id}">${m.displayName}</option>`);
        }
        select.append(group2);
    }

    // Restore previous selection if still available, or use saved setting
    const savedModel = extension_settings[extensionName].model;
    if (savedModel && select.find(`option[value="${savedModel}"]`).length) {
        select.val(savedModel);
    } else if (currentValue && select.find(`option[value="${currentValue}"]`).length) {
        select.val(currentValue);
    } else if (select.find('option').length > 0) {
        // Select first available option and save it
        const firstVal = select.find('option').first().val();
        select.val(firstVal);
        extension_settings[extensionName].model = firstVal;
        saveSettingsDebounced();
    }

    updateGenerationControlOptions(select.val());
    updateModelInfo();
}

async function getUserAvatar() {
    try {
        let avatarUrl = getAvatarPath(user_avatar);
        if (!avatarUrl) return null;

        const response = await fetch(avatarUrl);
        if (!response.ok) return null;

        const blob = await response.blob();
        const base64 = await getBase64Async(blob);
        const parts = base64.split(',');
        const mimeType = parts[0]?.match(/data:([^;]+)/)?.[1] || 'image/png';

        return { mimeType, data: parts[1] || base64, name: name1 || 'User' };
    } catch (error) {
        console.warn(`[${extensionName}] Error fetching user avatar:`, error);
        return null;
    }
}

async function getCharacterAvatar() {
    const context = getContext();
    const charList = getAvailableCharacters();
    const character = charList[context.characterId];
    if (!character?.avatar) return null;

    try {
        const avatarUrl = `/characters/${encodeURIComponent(character.avatar)}`;
        const response = await fetch(avatarUrl);
        if (!response.ok) return null;

        const blob = await response.blob();
        const base64 = await getBase64Async(blob);
        const parts = base64.split(',');
        const mimeType = parts[0]?.match(/data:([^;]+)/)?.[1] || 'image/png';

        return { mimeType, data: parts[1] || base64, name: context.name2 || 'Character' };
    } catch (error) {
        console.warn(`[${extensionName}] Error fetching character avatar:`, error);
        return null;
    }
}

async function getCharacterAvatarByName(charName) {
    const character = getCharacterByName(charName);
    if (!character?.avatar) return null;

    try {
        const avatarUrl = `/characters/${encodeURIComponent(character.avatar)}`;
        const response = await fetch(avatarUrl);
        if (!response.ok) return null;

        const blob = await response.blob();
        const base64 = await getBase64Async(blob);
        const parts = base64.split(',');
        const mimeType = parts[0]?.match(/data:([^;]+)/)?.[1] || 'image/png';

        return { mimeType, data: parts[1] || base64, name: character.name || charName };
    } catch (error) {
        console.warn(`[${extensionName}] Error fetching avatar for ${charName}:`, error);
        return null;
    }
}

function getRecentMessages(depth, fromMessageId = null) {
    const context = getContext();
    const chat = context.chat;
    if (!chat || chat.length === 0) return [];

    const messages = [];

    // If fromMessageId is specified, start from that message
    // Otherwise start from the last message
    const startIndex = fromMessageId !== null ? fromMessageId : chat.length - 1;

    // Get messages starting from startIndex going backwards
    for (let i = startIndex; i >= 0 && messages.length < depth; i--) {
        const message = chat[i];
        if (message && message.mes && !message.is_system) {
            messages.unshift({
                text: message.mes,
                isUser: message.is_user,
                name: message.is_user ? (name1 || 'User') : (context.name2 || 'Character'),
                messageId: i,
            });
        }
    }
    return messages;
}

function getCharacterDescriptions() {
    const context = getContext();
    const character = context.characters[context.characterId];
    return {
        user_name: name1 || 'User',
        user_persona: power_user.persona_description || '',
        char_name: context.name2 || 'Character',
        char_description: character?.description || '',
        char_scenario: character?.scenario || '',
    };
}

/**
 * Clean text from HTML tags, markdown, and other formatting
 */
function cleanText(text) {
    if (!text) return '';

    return text
        // Remove HTML tags
        .replace(/<[^>]*>/g, '')
        // Remove markdown bold/italic
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        // Remove markdown headers
        .replace(/^#{1,6}\s+/gm, '')
        // Remove markdown links
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // Remove markdown code blocks
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        // Remove excessive whitespace
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extract visual/scene description from message text
 * Removes dialogue, keeps actions and descriptions
 */
function extractVisualContent(text) {
    let cleaned = cleanText(text);

    // Remove dialogue in various quote styles
    cleaned = cleaned
        .replace(/"[^"]*"/g, '') // Double quotes
        .replace(/"[^"]*"/g, '') // Smart quotes
        .replace(/「[^」]*」/g, '') // Japanese
        .replace(/『[^』]*』/g, '')
        .replace(/«[^»]*»/g, ''); // Guillemets

    // Remove OOC and meta content
    cleaned = cleaned
        .replace(/\([^)]*OOC[^)]*\)/gi, '')
        .replace(/OOC:.*?(?=\n|$)/gi, '')
        .replace(/\{\{[^}]*\}\}/g, '');

    // Clean up whitespace and punctuation
    cleaned = cleaned
        .replace(/\s+/g, ' ')
        .replace(/\s*[,]\s*[,]+/g, ',')
        .replace(/^\s*[,.:;]\s*/, '')
        .trim();

    return cleaned;
}

/**
 * Build image generation prompt from scene content
 * Extracts visual descriptions and formats for image models
 */
function buildImagePrompt(sceneText, charName, userName) {
    // First extract visual content (removes dialogue)
    let prompt = extractVisualContent(sceneText);

    if (!prompt || prompt.length < 20) {
        // Fallback to cleaned full text if extraction removed too much
        prompt = cleanText(sceneText);
    }

    // Replace placeholders with names
    prompt = prompt
        .replace(/\{\{char\}\}/gi, charName || 'the character')
        .replace(/\{\{user\}\}/gi, userName || 'the person');

    return prompt;
}

/**
 * Create a condensed visual summary for image generation
 * Focuses on the most important visual elements
 */
function createVisualSummary(text, charName, userName, maxLength = 800) {
    let content = buildImagePrompt(text, charName, userName);

    if (content.length <= maxLength) {
        return content;
    }

    // Try to extract key sentences (those with visual keywords)
    const visualKeywords = /\b(look|appear|wear|dress|hair|eye|face|body|stand|sit|lie|walk|run|hold|touch|smile|frown|expression|room|place|light|dark|color|red|blue|green|black|white|tall|short|young|old)\w*/gi;

    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const visualSentences = sentences.filter(s => visualKeywords.test(s));

    if (visualSentences.length > 0) {
        let summary = visualSentences.join('. ').trim();
        if (summary.length > maxLength) {
            summary = summary.substring(0, maxLength - 3) + '...';
        }
        return summary;
    }

    // Fallback: just truncate
    return content.substring(0, maxLength - 3) + '...';
}

function escapeRegex(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatSummaryForReadability(summary, characterNames = []) {
    const text = String(summary || '').trim();
    if (!text) return text;

    // Already formatted
    if (text.includes('\nCharacters:') || /\n-\s+\S+:/m.test(text)) {
        let formatted = text
            .replace(/(\n\s*-\s+[^\n]+)\n(?=\s*-\s+)/g, '$1\n\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        const sceneIndex = formatted.indexOf('Scene:');
        const charsIndex = formatted.indexOf('Characters:');
        if (sceneIndex !== -1 && charsIndex !== -1 && sceneIndex < charsIndex) {
            const scenePart = formatted.slice(sceneIndex + 'Scene:'.length, charsIndex).trim();
            const charsPart = formatted.slice(charsIndex + 'Characters:'.length).trim();
            formatted = `Characters:\n${charsPart}${scenePart ? `\n\nScene: ${scenePart}` : ''}`;
        }

        return formatted.trim();
    }

    const names = [];
    const seen = new Set();
    for (const name of characterNames) {
        const trimmed = String(name || '').trim();
        const key = trimmed.toLowerCase();
        if (!trimmed || seen.has(key)) continue;
        seen.add(key);
        names.push(trimmed);
    }

    if (names.length === 0) return text;

    const namePattern = names
        .sort((a, b) => b.length - a.length)
        .map(escapeRegex)
        .join('|');

    const labelRegex = new RegExp(`\\b(?:${namePattern})\\s*:`, 'g');
    const matches = [...text.matchAll(labelRegex)];
    if (matches.length === 0) return text;

    const firstStart = matches[0].index ?? 0;
    let scenePart = text.slice(0, firstStart).trim().replace(/[,\s]+$/, '');
    if (scenePart && !/[.!?]$/.test(scenePart)) {
        scenePart += '.';
    }

    const characterLines = [];
    for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index ?? 0;
        const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
        const chunk = text.slice(start, end).trim().replace(/^[,;\s]+/, '').replace(/[,\s]+$/, '');
        if (chunk) characterLines.push(chunk);
    }

    if (characterLines.length === 0) return text;

    const charactersBlock = `Characters:\n- ${characterLines.join('\n\n- ')}`;
    const sceneHeading = scenePart ? `Scene: ${scenePart}` : '';
    return `${charactersBlock}${sceneHeading ? `\n\n${sceneHeading}` : ''}`.trim();
}

/**
 * Use AI to summarize scene into an image generation prompt
 */
async function summarizeWithAI(text, charName, userName, additionalCharacters = []) {
    const settings = extension_settings[extensionName];

    if (!getCurrentApiKey()) {
        throw new Error('API key required for summarization');
    }

    // Get character descriptions using the effective functions (respects custom overrides)
    const charDesc = getEffectiveCharDescription();
    const userDesc = getEffectiveUserDescription();

    const normalizedExtras = [];
    const seenNames = new Set([String(charName || '').toLowerCase(), String(userName || '').toLowerCase()]);
    for (const item of Array.isArray(additionalCharacters) ? additionalCharacters : []) {
        const name = String(item?.name || '').trim();
        if (!name) continue;

        const key = name.toLowerCase();
        if (seenNames.has(key)) continue;
        seenNames.add(key);

        const description = String(item?.description || '').trim() || 'No description available';
        normalizedExtras.push({ name, description });
    }

    const appearanceLines = [
        `${charName || 'Character'}: ${charDesc || 'No description available'}`,
        `${userName || 'User'}: ${userDesc || 'No description available'}`,
        ...normalizedExtras.map(item => `${item.name}: ${item.description}`),
    ];
    const listedCharacterNames = [
        charName || 'Character',
        userName || 'User',
        ...normalizedExtras.map(item => item.name),
    ];
    addRuntimeLog('info', 'Summarizer started', {
        model: settings.summarizer_model,
        charName,
        userName,
        additionalCharacters: normalizedExtras.map(item => item.name),
        inputTextLength: String(text || '').length,
    });

    console.log(`[${extensionName}] summarizeWithAI - charName: ${charName}, userName: ${userName}`);
    console.log(`[${extensionName}] summarizeWithAI - charDesc (first 100): ${charDesc?.substring(0, 100)}...`);
    console.log(`[${extensionName}] summarizeWithAI - userDesc (first 100): ${userDesc?.substring(0, 100)}...`);
    console.log(`[${extensionName}] summarizeWithAI - additional characters:`, normalizedExtras.map(item => item.name));

    const systemPrompt = `You are an image prompt generator for AI art.

CHARACTER APPEARANCES (COPY THESE EXACTLY - do not paraphrase or change details):
${appearanceLines.join('\n\n')}

TASK:
1. First output ALL listed character appearance anchors using the exact details above.
2. Then write a concise scene description (2-3 sentences) including pose, composition, environment, and lighting.

CRITICAL: Hair colors, gradients, lengths, and other specific details must be copied EXACTLY as written above. Do not reverse gradients or change any visual details.
CRITICAL: Character appearance accuracy is the highest priority and must override scene details.
CRITICAL: Do NOT invent or embellish clothing/body details that are not in the appearance anchors.
CRITICAL: Keep the output structured and readable using line breaks and bullets.
CRITICAL: Put one blank line between each character bullet.

Output format:
Characters:
- [Name]: [Exact appearance details]
- [Name]: [Exact appearance details]

Scene: [2-3 descriptive sentences]
`;

    // Clean the text (removes HTML, markdown, etc) and allow up to 6000 chars for better context
    const cleanedText = typeof text === 'string' ? text : cleanText(text);
    const userPrompt = `Scene to convert into an image prompt:

${cleanedText.substring(0, 5000)}`;

    console.log(`[${extensionName}] Summarizing with ${settings.summarizer_model} (input: ${cleanedText.length} chars)...`);
    console.log(`[${extensionName}] System prompt being sent:\n${systemPrompt}`);

    const chatBody = {
        model: settings.summarizer_model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        max_tokens: 2500,
        temperature: 0.3,
    };

    try {
        addRuntimeLog('debug', 'Summarizer request body', chatBody);
        const respJson = await sendChatRequest(settings, chatBody);
        const summary = respJson.choices?.[0]?.message?.content?.trim();
        if (!summary) throw new Error('No summary returned');
        const formattedSummary = formatSummaryForReadability(summary, listedCharacterNames);
        console.log(`[${extensionName}] AI Summary:`, formattedSummary);
        addRuntimeLog('info', 'Summarizer completed', {
            model: chatBody.model,
            summaryLength: formattedSummary.length,
            summaryPreview: formattedSummary.substring(0, 1200),
        });
        return formattedSummary;
    } catch (err) {
        console.error(`[${extensionName}] Summarizer error:`, err);
        addRuntimeLog('error', 'Summarizer failed', {
            model: chatBody.model,
            error: err,
        });
        const msg = (err?.message || '').toString().toLowerCase();

        // Detect model missing or provider route errors and try fallback
        if (msg.includes('model_not_found') || msg.includes('model not found') || msg.includes('503')) {
            toastr.warning(`Summarizer model "${settings.summarizer_model}" not available. Trying to find an alternative...`, 'Pawtrait');

            // Refresh chat models silently
            await fetchSummarizerModelsFromAPI(true);

            // Try to find a preferred alternative from cached models
            const candidate = findPreferredSummarizerFromCachedModels();
            if (candidate && candidate !== settings.summarizer_model) {
                const previousModel = settings.summarizer_model;
                extension_settings[extensionName].summarizer_model = candidate;
                saveSettingsDebounced();
                toastr.info(`Switched summarizer to ${candidate}. Retrying...`, 'Pawtrait');
                addRuntimeLog('warn', 'Summarizer model switched for retry', {
                    previousModel,
                    candidate,
                });

                try {
                    chatBody.model = candidate;
                    addRuntimeLog('debug', 'Summarizer retry request body', chatBody);
                    const retryResp = await sendChatRequest(settings, chatBody);
                    const retrySummary = retryResp.choices?.[0]?.message?.content?.trim();
                    if (retrySummary) {
                        toastr.success('Summarizer succeeded with alternative model.', 'Pawtrait');
                        addRuntimeLog('info', 'Summarizer retry succeeded', {
                            model: candidate,
                            summaryLength: retrySummary.length,
                        });
                        return formatSummaryForReadability(retrySummary, listedCharacterNames);
                    }
                } catch (e) {
                    console.error(`[${extensionName}] Retry summarizer error:`, e);
                    addRuntimeLog('error', 'Summarizer retry failed', {
                        model: candidate,
                        error: e,
                    });
                    // fall through to local summary
                }
            }

            // Final fallback: local summarizer
            toastr.warning('Falling back to local summarizer.', 'Pawtrait');
            addRuntimeLog('warn', 'Using local summarizer fallback', {
                reason: msg || 'Unknown',
            });
            return createVisualSummary(text, charName, userName, settings.max_prompt_length || 800);
        }

        // Not a handled error - rethrow
        throw err;
    }
}

async function buildPromptText(prompt, sender = null, messageId = null) {
    const settings = extension_settings[extensionName];
    const context = getContext();
    const charName = context.name2 || 'Character';
    const userName = name1 || 'User';

    // Get the raw message content
    let rawContent = '';
    const depth = settings.message_depth || 1;

    if (messageId !== null || sender !== null) {
        const recentMessages = getRecentMessages(depth, messageId);
        if (recentMessages.length > 0) {
            rawContent = recentMessages.map(msg => msg.text).join('\n\n');
        }
    } else if (prompt) {
        rawContent = prompt;
    }
    addRuntimeLog('debug', 'Prompt context collected', {
        sender,
        messageId,
        charName,
        userName,
        depth,
        autoSummarize: settings.auto_summarize,
        includeDescriptions: settings.include_descriptions,
        rawContentLength: rawContent.length,
        rawContent,
    });

    // If auto-summarize is enabled, send the full cleaned text to AI
    if (settings.auto_summarize && getCurrentApiKey() && rawContent) {
        try {
            console.log(`[${extensionName}] Auto-summarizing with ${settings.summarizer_model}...`);
            const cleanedContent = cleanText(rawContent);
            const summary = await summarizeWithAI(cleanedContent, charName, userName);

            // Add system instruction prefix if set
            let finalPrompt = '';
            if (settings.system_instruction) {
                finalPrompt = settings.system_instruction + '\n\n';
            }
            finalPrompt += summary;

            console.log(`[${extensionName}] Auto-summarized prompt (${finalPrompt.length} chars):`, finalPrompt);
            addRuntimeLog('info', 'Prompt built (auto-summarized)', {
                model: settings.summarizer_model,
                length: finalPrompt.length,
                prompt: finalPrompt,
            });
            return finalPrompt.trim();
        } catch (error) {
            console.warn(`[${extensionName}] Auto-summarize failed, falling back to manual:`, error.message);
            addRuntimeLog('warn', 'Auto-summarize failed, using manual prompt build', {
                error,
            });
            // Fall through to manual processing
        }
    }

    // Manual processing (no auto-summarize or it failed)
    const parts = [];

    // Start with system instruction (style prefix)
    if (settings.system_instruction) {
        parts.push(settings.system_instruction);
    }

    // Add character visual descriptions if enabled
    if (settings.include_descriptions) {
        const desc = getCharacterDescriptions();
        const descParts = [];

        if (desc.char_description) {
            const cleanedDesc = cleanText(desc.char_description);
            const shortDesc = cleanedDesc.substring(0, 300);
            descParts.push(`${desc.char_name}: ${shortDesc}`);
        }
        if (desc.user_persona) {
            const cleanedPersona = cleanText(desc.user_persona);
            const shortPersona = cleanedPersona.substring(0, 200);
            descParts.push(`${desc.user_name}: ${shortPersona}`);
        }

        if (descParts.length > 0) {
            parts.push(`Characters:\n${descParts.join('\n')}`);
        }
    }

    // Build scene prompt from content
    let scenePrompt = '';
    if (rawContent) {
        scenePrompt = buildImagePrompt(rawContent, charName, userName);
    }

    if (scenePrompt) {
        parts.push(`Scene:\n${scenePrompt}`);
    }

    let fullPrompt = parts.join('\n\n');

    // Truncate if too long
    const maxLength = settings.max_prompt_length || 1000;
    if (fullPrompt.length > maxLength) {
        console.log(`[${extensionName}] Truncating prompt from ${fullPrompt.length} to ${maxLength} chars`);
        // Try to truncate at a sentence boundary
        let truncated = fullPrompt.substring(0, maxLength - 3);
        const lastPeriod = truncated.lastIndexOf('.');
        const lastSpace = truncated.lastIndexOf(' ');
        if (lastPeriod > maxLength - 100) {
            truncated = truncated.substring(0, lastPeriod + 1);
        } else if (lastSpace > maxLength - 50) {
            truncated = truncated.substring(0, lastSpace);
        }
        fullPrompt = truncated + '...';
    }

    console.log(`[${extensionName}] Built prompt (${fullPrompt.length} chars):`, fullPrompt);
    addRuntimeLog('info', 'Prompt built (manual)', {
        length: fullPrompt.length,
        prompt: fullPrompt,
    });
    return fullPrompt.trim();
}

async function generateImageFromPrompt(prompt, sender = null, messageId = null) {
    const settings = extension_settings[extensionName];
    addRuntimeLog('info', 'Image generation started', {
        provider: settings.provider,
        model: settings.model,
        sender,
        messageId,
    });

    if (!getCurrentApiKey()) {
        throw new Error('API Key is not set. Please enter your API key in the extension settings.');
    }
    if (!settings.api_endpoint) {
        throw new Error('API Endpoint is not set. Please enter the endpoint URL in the extension settings.');
    }

    const promptText = await buildPromptText(prompt, sender, messageId);
    const selectedAspectRatio = getEffectiveAspectRatioForModel(settings.aspect_ratio, settings.model);
    const modelProfile = getModelRuntimeProfile(settings.model);
    const effectiveSizeOption = getEffectiveModelSizeOption(modelProfile, settings.image_size, selectedAspectRatio);
    const requestSize = isDimensionImageSizeValue(effectiveSizeOption)
        ? normalizeImageDimensionValue(effectiveSizeOption)
        : getModelRequestSize(modelProfile, selectedAspectRatio);

    // Build the request body for OpenAI-compatible image generation
    const requestBody = {
        model: settings.model,
        prompt: promptText,
        n: 1,
        size: requestSize,
        aspect_ratio: selectedAspectRatio,
        response_format: 'b64_json',
    };

    if (effectiveSizeOption && isTierImageSizeValue(effectiveSizeOption)) {
        requestBody.image_size = effectiveSizeOption;
    }

    // Add reference images if enabled
    const imageDataUrls = [];

    if (settings.use_avatars) {
        const charAvatar = await getCharacterAvatar();
        const userAvatar = await getUserAvatar();

        if (charAvatar) {
            console.log(`[${extensionName}] Adding character avatar: ${charAvatar.name}`);
            imageDataUrls.push(`data:${charAvatar.mimeType};base64,${charAvatar.data}`);
        }
        if (userAvatar) {
            console.log(`[${extensionName}] Adding user avatar: ${userAvatar.name}`);
            imageDataUrls.push(`data:${userAvatar.mimeType};base64,${userAvatar.data}`);
        }
    }

    if (settings.use_previous_image && settings.gallery?.length > 0) {
        console.log(`[${extensionName}] Adding previous image as reference`);
        imageDataUrls.push(`data:image/png;base64,${settings.gallery[0].imageData}`);
    }

    // Add images to request (NanoGPT format)
    if (imageDataUrls.length === 1) {
        requestBody.imageDataUrl = imageDataUrls[0];
    } else if (imageDataUrls.length > 1) {
        requestBody.imageDataUrls = imageDataUrls;
    }

    addRuntimeLog('debug', 'Image request prepared', {
        provider: settings.provider,
        model: settings.model,
        selectedAspectRatio,
        effectiveSizeOption,
        requestBody,
        referenceImageCount: imageDataUrls.length,
    });

    console.log(`[${extensionName}] Calling provider image endpoint with model: ${settings.model}`);
    console.log(`[${extensionName}] Request body:`, JSON.stringify(requestBody, null, 2));

    const result = await sendImageRequest(settings, requestBody);
    if (result?.imageData) {
        addRuntimeLog('info', 'Image generation succeeded', {
            provider: settings.provider,
            model: settings.model,
            mimeType: result.mimeType || 'image/png',
            imageDataLength: String(result.imageData || '').length,
        });
        return { imageData: result.imageData, mimeType: result.mimeType || 'image/png' };
    }

    throw new Error('No image returned from API. Check your settings and try again.');
}

function getImageSize(aspectRatio, provider = null) {
    // Standard sizes that work with most OpenAI-compatible APIs
    const sizes = {
        '1:1': '1024x1024',
        '16:9': '1792x1024',  // OpenAI dall-e-3 landscape
        '9:16': '1024x1792',  // OpenAI dall-e-3 portrait
        '4:3': '1152x896',
        '3:4': '896x1152',
        '3:2': '1536x1024',   // gpt-image-1 landscape
        '2:3': '1024x1536',   // gpt-image-1 portrait
    };
    return sizes[aspectRatio] || '1024x1024';
}

/**
 * Check if a model is a Gemini image model (requires special API format)
 */
function isGeminiImageModel(modelId) {
    if (!modelId) return false;
    const id = modelId.toLowerCase();
    // Gemini image models have patterns like: gemini-*-image*, gemini-*-flash-image, etc.
    return id.includes('gemini') && id.includes('image');
}

function isOpenAIImageModel(modelId) {
    const id = (modelId || '').toString().toLowerCase();
    return id.startsWith('openai/') && id.includes('image');
}

/**
 * Convert aspect ratio to Gemini format
 */
function getGeminiAspectRatio(aspectRatio) {
    // Gemini supports: 1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
    const supported = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
    if (supported.includes(aspectRatio)) return aspectRatio;

    // Map common ratios to closest Gemini-supported ratio
    const mapping = {
        '16:9': '16:9',
        '9:16': '9:16',
        '4:3': '4:3',
        '3:4': '3:4',
        '3:2': '3:2',
        '2:3': '2:3',
    };
    return mapping[aspectRatio] || '1:1';
}

function isGemini3ProImagePreviewModel(modelId) {
    return (modelId || '').toString().toLowerCase().includes('gemini-3-pro-image-preview');
}

function isGemini25FlashImageModel(modelId) {
    return (modelId || '').toString().toLowerCase().includes('gemini-2.5-flash-image');
}

function getGeminiMaxReferenceImages(modelId) {
    if (isGemini25FlashImageModel(modelId)) return 3;
    if (isGemini3ProImagePreviewModel(modelId)) return 14;
    return 5;
}

function clampGeminiReferenceImages(imageUrls, modelId) {
    const maxImages = getGeminiMaxReferenceImages(modelId);
    if (!Array.isArray(imageUrls) || imageUrls.length <= maxImages) return imageUrls || [];

    const modelName = modelId || 'Gemini model';
    const clipped = imageUrls.slice(0, maxImages);
    toastr.warning(`${modelName} supports up to ${maxImages} reference images. Using the first ${maxImages}.`, 'Pawtrait');
    return clipped;
}

function collectReferenceImageDataUrls(requestBody) {
    const urls = [];
    if (!requestBody || typeof requestBody !== 'object') return urls;

    if (typeof requestBody.imageDataUrl === 'string' && requestBody.imageDataUrl.trim()) {
        urls.push(requestBody.imageDataUrl.trim());
    }

    if (Array.isArray(requestBody.imageDataUrls)) {
        for (const url of requestBody.imageDataUrls) {
            if (typeof url === 'string' && url.trim()) {
                urls.push(url.trim());
            }
        }
    }

    return urls;
}

function dataUrlToGeminiInlineDataPart(dataUrl) {
    const match = String(dataUrl || '').match(/^data:(image\/[^;,]+)(?:;[^,]*)?;base64,(.+)$/i);
    if (!match) return null;

    return {
        inlineData: {
            mimeType: match[1],
            data: match[2],
        },
    };
}

function getGeminiImageSizeFromRequestedSize(sizeText) {
    const size = String(sizeText || '');
    const match = size.match(/^(\d+)x(\d+)$/);
    if (!match) return '1K';

    const width = Number(match[1]) || 0;
    const height = Number(match[2]) || 0;
    const maxDimension = Math.max(width, height);

    if (maxDimension >= 3000) return '4K';
    if (maxDimension >= 1400) return '2K';
    return '1K';
}

function prependAspectRatioDirective(prompt, aspectRatio) {
    const cleanedPrompt = String(prompt || '').trim();
    const ratio = getGeminiAspectRatio(aspectRatio || '1:1');

    // Do not add duplicate aspect-ratio locks
    const ratioRegex = new RegExp(`aspect\\s*ratio[^\\n]*${escapeRegex(ratio)}`, 'i');
    if (ratioRegex.test(cleanedPrompt)) return cleanedPrompt;

    const lockText = `Aspect ratio lock: ${ratio}. Final image must strictly use ${ratio}.`;
    if (!cleanedPrompt) return lockText;
    return `${lockText}\n\n${cleanedPrompt}`;
}

/**
 * Send image request using Gemini native format (for LinkAPI Gemini models)
 * Uses /v1beta/models/{model}:generateContent endpoint
 */
async function sendGeminiImageRequest(settings, requestBody) {
    const modelId = requestBody.model;
    const endpoint = `https://api.linkapi.ai/v1beta/models/${modelId}:generateContent`;
    const aspectRatio = getGeminiAspectRatio(requestBody.aspect_ratio || settings.aspect_ratio || '1:1');
    const promptText = prependAspectRatioDirective(requestBody.prompt, aspectRatio);
    const rawImageUrls = collectReferenceImageDataUrls(requestBody);
    const imageUrls = clampGeminiReferenceImages(rawImageUrls, modelId);

    // Build Gemini-format request
    const parts = [];
    let skippedImageCount = 0;

    // For image editing, place reference image parts before text guidance.
    for (const dataUrl of imageUrls) {
        const part = dataUrlToGeminiInlineDataPart(dataUrl);
        if (part) {
            parts.push(part);
        } else {
            skippedImageCount++;
        }
    }
    if (skippedImageCount > 0) {
        toastr.warning(`Skipped ${skippedImageCount} invalid reference image(s) for ${modelId}.`, 'Pawtrait');
    }

    // Add text prompt
    if (promptText) {
        parts.push({ text: promptText });
    }
    if (parts.length === 0) {
        throw new Error('No prompt text or valid reference images were provided.');
    }

    console.log(`[${extensionName}] Gemini refs included: ${imageUrls.length}, prompt chars: ${promptText.length}`);

    const imageConfig = {
        aspectRatio,
    };

    // Gemini 3 preview supports explicit image size tiers.
    if (isGemini3ProImagePreviewModel(modelId)) {
        const selectedImageSize = String(requestBody.image_size || settings.image_size || '').trim();
        imageConfig.imageSize = selectedImageSize || getGeminiImageSizeFromRequestedSize(requestBody.size);
    }

    const geminiRequestBody = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig,
        }
    };

    const headers = {
        'Content-Type': 'application/json',
    };
    if (getCurrentApiKey()) headers['Authorization'] = `Bearer ${getCurrentApiKey()}`;
    addRuntimeLog('debug', 'Sending Gemini image request', {
        endpoint,
        modelId,
        requestBody: geminiRequestBody,
    });

    console.log(`[${extensionName}] Sending Gemini image request to ${endpoint}`);
    console.log(`[${extensionName}] Gemini request body:`, JSON.stringify(geminiRequestBody, null, 2));

    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(geminiRequestBody),
    });
    addRuntimeLog('debug', 'Gemini image response status', {
        endpoint,
        modelId,
        status: response.status,
        ok: response.ok,
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${extensionName}] Gemini API Error:`, response.status, errorText);
        addRuntimeLog('error', 'Gemini image request failed', {
            endpoint,
            modelId,
            status: response.status,
            errorText,
        });
        let errorMessage = `Gemini API Error ${response.status}`;
        try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
        } catch (err) {
            if (errorText) errorMessage += `: ${errorText}`;
        }
        throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log(`[${extensionName}] Gemini response:`, JSON.stringify(result, null, 2).substring(0, 500));
    addRuntimeLog('debug', 'Gemini image response payload', {
        endpoint,
        modelId,
        result,
    });

    // Parse Gemini response format:
    // { candidates: [{ content: { parts: [{ text: "..." }, { inlineData: { mimeType: "image/png", data: "base64..." } }] } }] }
    const candidates = result.candidates || [];
    if (candidates.length === 0) {
        throw new Error('No candidates in Gemini response');
    }

    const contentParts = candidates[0]?.content?.parts || [];

    // Find the image part (inlineData or inline_data)
    for (const part of contentParts) {
        const inlineData = part.inlineData || part.inline_data;
        if (inlineData && inlineData.data) {
            addRuntimeLog('info', 'Gemini image response parsed', {
                modelId,
                mimeType: inlineData.mimeType || inlineData.mime_type || 'image/png',
                imageDataLength: String(inlineData.data || '').length,
            });
            return {
                imageData: inlineData.data,
                mimeType: inlineData.mimeType || inlineData.mime_type || 'image/png'
            };
        }
    }

    // No image found in response
    console.error(`[${extensionName}] No image found in Gemini response parts:`, contentParts);
    addRuntimeLog('error', 'Gemini response missing image', {
        modelId,
        contentParts,
    });
    throw new Error('No image returned from Gemini. The model may have returned text only.');
}

/**
 * Send image request using OpenRouter's chat completions format
 * OpenRouter uses /v1/chat/completions with modalities: ["image", "text"]
 */
async function sendOpenRouterImageRequest(settings, requestBody) {
    const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    const aspectRatio = getGeminiAspectRatio(requestBody.aspect_ratio || settings.aspect_ratio || '1:1');
    const promptText = prependAspectRatioDirective(requestBody.prompt, aspectRatio);
    const modelProfile = getModelRuntimeProfile(requestBody.model, 'openrouter');
    let imageUrls = collectReferenceImageDataUrls(requestBody);
    if (modelProfile.family === 'gemini-image') {
        imageUrls = clampGeminiReferenceImages(imageUrls, requestBody.model);
    } else if (Number.isFinite(modelProfile.maxReferenceImages) && modelProfile.maxReferenceImages > 0 && imageUrls.length > modelProfile.maxReferenceImages) {
        imageUrls = imageUrls.slice(0, modelProfile.maxReferenceImages);
        toastr.warning(`${modelProfile.modelId} supports up to ${modelProfile.maxReferenceImages} reference images. Using the first ${modelProfile.maxReferenceImages}.`, 'Pawtrait');
    }

    // Build messages array with prompt and optional reference images
    const contentParts = [];

    // OpenRouter recommends putting text first for mixed text+image prompts.
    if (promptText) {
        contentParts.push({ type: 'text', text: promptText });
    }

    for (const dataUrl of imageUrls) {
        contentParts.push({
            type: 'image_url',
            image_url: { url: dataUrl }
        });
    }

    const imageConfig = {
        aspect_ratio: aspectRatio,
    };
    if (modelProfile.family === 'openai-image' || modelProfile.prefersDimensionSize) {
        imageConfig.size = requestBody.size || getImageSize(settings.aspect_ratio || '1:1');
        delete imageConfig.aspect_ratio;
    }
    if (isGemini3ProImagePreviewModel(requestBody.model)) {
        const selectedImageSize = String(requestBody.image_size || settings.image_size || '').trim();
        imageConfig.image_size = selectedImageSize || getGeminiImageSizeFromRequestedSize(requestBody.size);
    }

    const openRouterRequestBody = {
        model: requestBody.model,
        messages: [
            {
                role: 'user',
                content: contentParts.length === 1 && contentParts[0].type === 'text'
                    ? contentParts[0].text
                    : contentParts
            }
        ],
        modalities: ['image', 'text'],
        stream: false,
        image_config: imageConfig,
    };

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getCurrentApiKey()}`,
        'HTTP-Referer': window?.location?.origin || 'https://sillytavern.app',
        'X-Title': 'SillyTavern Pawtrait'
    };
    addRuntimeLog('debug', 'Sending OpenRouter chat image request', {
        endpoint,
        model: requestBody.model,
        requestBody: openRouterRequestBody,
    });

    console.log(`[${extensionName}] Sending OpenRouter image request to ${endpoint}`);
    console.log(`[${extensionName}] OpenRouter request body:`, JSON.stringify(openRouterRequestBody, null, 2));

    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(openRouterRequestBody),
    });
    addRuntimeLog('debug', 'OpenRouter chat image response status', {
        endpoint,
        model: requestBody.model,
        status: response.status,
        ok: response.ok,
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${extensionName}] OpenRouter API Error:`, response.status, errorText);
        addRuntimeLog('error', 'OpenRouter chat image request failed', {
            endpoint,
            model: requestBody.model,
            status: response.status,
            errorText,
        });
        let errorMessage = `OpenRouter API Error ${response.status}`;
        try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
        } catch (err) {
            if (errorText.length < 200) errorMessage += `: ${errorText}`;
        }
        throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log(`[${extensionName}] OpenRouter response:`, JSON.stringify(result, null, 2).substring(0, 1000));
    addRuntimeLog('debug', 'OpenRouter chat image response payload', {
        endpoint,
        model: requestBody.model,
        result,
    });

    // Parse OpenRouter response format:
    // { choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,..." } }] } }] }
    const message = result.choices?.[0]?.message;
    if (!message) {
        throw new Error('No message in OpenRouter response');
    }

    // Check for images array
    if (message.images && message.images.length > 0) {
        const imageData = message.images[0];
        const url = imageData.image_url?.url || imageData.url;
        if (url && url.startsWith('data:')) {
            // Parse data URL: data:image/png;base64,xxxxx
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
                addRuntimeLog('info', 'OpenRouter chat image response parsed (data URL)', {
                    model: requestBody.model,
                    mimeType: match[1],
                    imageDataLength: String(match[2] || '').length,
                });
                return {
                    imageData: match[2],
                    mimeType: match[1]
                };
            }
        }
        if (url && /^https?:\/\//i.test(url)) {
            const imageResponse = await fetch(url);
            if (imageResponse.ok) {
                const blob = await imageResponse.blob();
                const base64 = await getBase64Async(blob);
                const parts = base64.split(',');
                const mimeType = parts[0]?.match(/data:([^;]+)/)?.[1] || blob.type || 'image/png';
                const imageData64 = parts[1] || base64;
                return {
                    imageData: imageData64,
                    mimeType,
                };
            }
        }
    }

    // No image found in response
    console.error(`[${extensionName}] No image found in OpenRouter response:`, message);
    addRuntimeLog('error', 'OpenRouter chat response missing image', {
        model: requestBody.model,
        message,
    });
    throw new Error('No image returned from OpenRouter. The model may have returned text only.');
}

async function sendOpenRouterResponsesImageRequest(settings, requestBody) {
    const endpoint = 'https://openrouter.ai/api/v1/responses';
    const aspectRatio = getGeminiAspectRatio(requestBody.aspect_ratio || settings.aspect_ratio || '1:1');
    const promptText = prependAspectRatioDirective(requestBody.prompt, aspectRatio);
    const modelProfile = getModelRuntimeProfile(requestBody.model, 'openrouter');
    let imageUrls = collectReferenceImageDataUrls(requestBody);
    if (Number.isFinite(modelProfile.maxReferenceImages) && modelProfile.maxReferenceImages > 0 && imageUrls.length > modelProfile.maxReferenceImages) {
        imageUrls = imageUrls.slice(0, modelProfile.maxReferenceImages);
        toastr.warning(`${modelProfile.modelId} supports up to ${modelProfile.maxReferenceImages} reference images. Using the first ${modelProfile.maxReferenceImages}.`, 'Pawtrait');
    }

    const inputContent = [];
    if (promptText) {
        inputContent.push({
            type: 'input_text',
            text: promptText,
        });
    }
    for (const dataUrl of imageUrls) {
        inputContent.push({
            type: 'input_image',
            detail: 'high',
            image_url: dataUrl,
        });
    }

    const imageConfig = {
        size: requestBody.size || getImageSize(settings.aspect_ratio || '1:1'),
    };

    const responsesRequestBody = {
        model: requestBody.model,
        input: [{ role: 'user', content: inputContent }],
        modalities: ['image', 'text'],
        stream: false,
        image_config: imageConfig,
    };

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getCurrentApiKey()}`,
        'HTTP-Referer': window?.location?.origin || 'https://sillytavern.app',
        'X-Title': 'SillyTavern Pawtrait'
    };
    addRuntimeLog('debug', 'Sending OpenRouter Responses image request', {
        endpoint,
        model: requestBody.model,
        requestBody: responsesRequestBody,
    });

    console.log(`[${extensionName}] Sending OpenRouter Responses API request to ${endpoint}`);
    console.log(`[${extensionName}] OpenRouter Responses request body:`, JSON.stringify(responsesRequestBody, null, 2));

    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(responsesRequestBody),
    });
    addRuntimeLog('debug', 'OpenRouter Responses image status', {
        endpoint,
        model: requestBody.model,
        status: response.status,
        ok: response.ok,
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${extensionName}] OpenRouter Responses API Error:`, response.status, errorText);
        addRuntimeLog('error', 'OpenRouter Responses image request failed', {
            endpoint,
            model: requestBody.model,
            status: response.status,
            errorText,
        });
        let errorMessage = `OpenRouter Responses API Error ${response.status}`;
        try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
        } catch (err) {
            if (errorText.length < 400) errorMessage += `: ${errorText}`;
        }
        throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log(`[${extensionName}] OpenRouter Responses API response:`, JSON.stringify(result, null, 2).substring(0, 1000));
    addRuntimeLog('debug', 'OpenRouter Responses payload', {
        endpoint,
        model: requestBody.model,
        result,
    });

    const outputItems = Array.isArray(result.output) ? result.output : [];
    for (const item of outputItems) {
        if (item?.type === 'image_generation_call' && typeof item.result === 'string' && item.result.length > 0) {
            addRuntimeLog('info', 'OpenRouter Responses parsed image', {
                model: requestBody.model,
                imageDataLength: item.result.length,
            });
            return {
                imageData: item.result,
                mimeType: 'image/png',
            };
        }
    }

    const message = outputItems.find(item => item?.type === 'message');
    const outputText = Array.isArray(message?.content)
        ? message.content.filter(part => part?.type === 'output_text').map(part => part?.text).join('\n').trim()
        : '';

    if (outputText) {
        addRuntimeLog('error', 'OpenRouter Responses returned text instead of image', {
            model: requestBody.model,
            outputText,
        });
        throw new Error(`No image returned from OpenRouter Responses API. Model output: ${outputText}`);
    }

    addRuntimeLog('error', 'OpenRouter Responses missing image output', {
        model: requestBody.model,
        result,
    });
    throw new Error('No image returned from OpenRouter Responses API.');
}

/**
 * Send image request to Pollinations.ai
 * Uses gen.pollinations.ai with API key
 */
async function sendPollinationsImageRequest(settings, requestBody) {
    const prompt = requestBody.prompt || '';
    const model = requestBody.model || 'flux';
    const apiKey = getCurrentApiKey();

    if (!apiKey) {
        throw new Error('Pollinations API key is required. Get one at enter.pollinations.ai');
    }

    // Get dimensions from aspect ratio
    const dimensions = getPollinationsDimensions(requestBody.aspect_ratio || settings.aspect_ratio || '1:1');

    // Build URL with query parameters
    const params = new URLSearchParams();
    params.set('model', model);
    params.set('width', dimensions.width.toString());
    params.set('height', dimensions.height.toString());
    params.set('nologo', 'true');
    params.set('enhance', 'false');
    params.set('key', apiKey);

    // URL-encode the prompt
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://gen.pollinations.ai/image/${encodedPrompt}?${params.toString()}`;
    addRuntimeLog('debug', 'Sending Pollinations image request', {
        model,
        imageUrl,
        promptLength: prompt.length,
        aspectRatio: requestBody.aspect_ratio || settings.aspect_ratio || '1:1',
    });

    console.log(`[${extensionName}] Fetching Pollinations image from: ${imageUrl.substring(0, 200)}...`);

    // Retry logic for transient errors (502, 503, 504)
    let lastError;
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                console.log(`[${extensionName}] Retry attempt ${attempt}/${maxRetries}...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }

            const response = await fetch(imageUrl);
            addRuntimeLog('debug', 'Pollinations image response status', {
                model,
                attempt,
                status: response.status,
                ok: response.ok,
            });

            if (response.ok) {
                const blob = await response.blob();
                const base64 = await getBase64Async(blob);
                const parts = base64.split(',');
                const mimeType = parts[0]?.match(/data:([^;]+)/)?.[1] || blob.type || 'image/png';
                const imageData = parts[1] || base64;

                console.log(`[${extensionName}] Pollinations image received: ${mimeType}, ${imageData.length} chars`);
                addRuntimeLog('info', 'Pollinations image response parsed', {
                    model,
                    mimeType,
                    imageDataLength: imageData.length,
                    attempt,
                });
                return { imageData, mimeType };
            }

            if (response.status >= 500 && attempt < maxRetries) {
                console.warn(`[${extensionName}] Pollinations server error ${response.status}, will retry...`);
                lastError = new Error(`Pollinations API Error ${response.status}`);
                continue;
            }

            const errorText = await response.text();
            addRuntimeLog('error', 'Pollinations image request failed', {
                model,
                attempt,
                status: response.status,
                errorText,
            });
            throw new Error(`Pollinations API Error ${response.status}: ${errorText.substring(0, 200)}`);

        } catch (error) {
            lastError = error;
            addRuntimeLog('warn', 'Pollinations image attempt failed', {
                model,
                attempt,
                error,
            });
            if (attempt >= maxRetries || !error.message?.includes('50')) {
                throw error;
            }
        }
    }

    throw lastError || new Error('Pollinations request failed after retries');
}

/**
 * Get dimensions for Pollinations based on aspect ratio
 */
function getPollinationsDimensions(aspectRatio) {
    const dimensions = {
        '1:1': { width: 1024, height: 1024 },
        '16:9': { width: 1344, height: 768 },
        '9:16': { width: 768, height: 1344 },
        '4:3': { width: 1152, height: 896 },
        '3:4': { width: 896, height: 1152 },
        '3:2': { width: 1216, height: 832 },
        '2:3': { width: 832, height: 1216 },
    };
    return dimensions[aspectRatio] || dimensions['1:1'];
}

/**
 * Provider-agnostic image request helper
 * Accepts the same requestBody format used throughout this extension
 */
async function sendImageRequest(settings, requestBody) {
    const providerConfig = getProviderConfig(settings);
    const modelProfile = getModelRuntimeProfile(requestBody.model, providerConfig.id);
    addRuntimeLog('info', 'Routing image request', {
        provider: providerConfig.id,
        model: requestBody.model,
        transport: modelProfile.transport,
        supportsImageInput: modelProfile.supportsImageInput,
    });

    // Route by provider + selected model profile.
    if (modelProfile.transport === 'linkapi-gemini-native') {
        console.log(`[${extensionName}] Using LinkAPI Gemini native format for model: ${modelProfile.modelId}`);
        return sendGeminiImageRequest(settings, requestBody);
    }

    // OpenRouter supports both chat-completions and responses transports depending on model.
    if (providerConfig.id === 'openrouter') {
        const hasReferenceImages = !!requestBody.imageDataUrl || (Array.isArray(requestBody.imageDataUrls) && requestBody.imageDataUrls.length > 0);
        if (modelProfile.transport === 'openrouter-responses' && hasReferenceImages) {
            console.log(`[${extensionName}] Using OpenRouter Responses API for model: ${modelProfile.modelId}`);
            try {
                return await sendOpenRouterResponsesImageRequest(settings, requestBody);
            } catch (error) {
                console.warn(`[${extensionName}] OpenRouter Responses API failed, retrying via chat completions:`, error?.message || error);
                addRuntimeLog('warn', 'OpenRouter Responses failed, fallback to chat', {
                    model: modelProfile.modelId,
                    error,
                });
            }
        }
        console.log(`[${extensionName}] Using OpenRouter chat completions for model: ${modelProfile.modelId}`);
        return sendOpenRouterImageRequest(settings, requestBody);
    }

    if (modelProfile.transport === 'pollinations-url') {
        console.log(`[${extensionName}] Using Pollinations URL-based API for image generation`);
        return sendPollinationsImageRequest(settings, requestBody);
    }

    const endpoint = settings.api_endpoint || providerConfig.defaultApiEndpoint;
    if (!endpoint) throw new Error('No API endpoint configured for selected provider.');

    // Build provider-specific request body
    let finalRequestBody = { ...requestBody };

    // LinkAPI.ai uses standard OpenAI format - remove NanoGPT-specific fields
    if (providerConfig.id === 'linkapi') {
        delete finalRequestBody.imageDataUrl;
        delete finalRequestBody.imageDataUrls;
    }

    // Custom gateways often expect aspect_ratio in addition to size for image models.
    if (providerConfig.id === 'custom') {
        const selectedAspectRatio = getGeminiAspectRatio(requestBody.aspect_ratio || settings.aspect_ratio || '1:1');
        finalRequestBody.aspect_ratio = selectedAspectRatio;
        finalRequestBody.prompt = prependAspectRatioDirective(finalRequestBody.prompt, selectedAspectRatio);

        const normalizedSizeOption = normalizeImageSizeOptionValue(finalRequestBody.image_size || settings.image_size);
        if (normalizedSizeOption && isTierImageSizeValue(normalizedSizeOption)) {
            finalRequestBody.image_size = normalizedSizeOption;
        } else if (normalizedSizeOption && isDimensionImageSizeValue(normalizedSizeOption) && !finalRequestBody.size) {
            finalRequestBody.size = normalizedSizeOption;
            delete finalRequestBody.image_size;
        } else if (!normalizedSizeOption) {
            delete finalRequestBody.image_size;
        }
    }

    const headers = {
        'Content-Type': 'application/json',
    };
    if (getCurrentApiKey()) headers['Authorization'] = `Bearer ${getCurrentApiKey()}`;

    // Optional OpenRouter attribution headers
    if (providerConfig.id === 'openrouter') {
        try {
            headers['HTTP-Referer'] = window?.location?.origin || '';
            headers['X-Title'] = document?.title || '';
        } catch (e) {}
    }
    addRuntimeLog('debug', 'Sending generic provider image request', {
        provider: providerConfig.id,
        endpoint,
        model: requestBody.model,
        requestBody: finalRequestBody,
    });

    console.log(`[${extensionName}] Sending image request to ${endpoint}`);
    console.log(`[${extensionName}] Request body:`, JSON.stringify(finalRequestBody, null, 2));

    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(finalRequestBody),
    });
    addRuntimeLog('debug', 'Generic provider image response status', {
        provider: providerConfig.id,
        endpoint,
        model: requestBody.model,
        status: response.status,
        ok: response.ok,
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${extensionName}] Provider API Error:`, response.status, errorText);
        addRuntimeLog('error', 'Generic provider image request failed', {
            provider: providerConfig.id,
            endpoint,
            model: requestBody.model,
            status: response.status,
            errorText,
        });
        let errorMessage = `API Error ${response.status}`;
        try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
        } catch (err) {
            if (errorText) errorMessage += `: ${errorText}`;
        }
        throw new Error(errorMessage);
    }

    const result = await response.json();
    addRuntimeLog('debug', 'Generic provider image payload', {
        provider: providerConfig.id,
        endpoint,
        model: requestBody.model,
        result,
    });

    // Try to extract base64 image data from common response shapes
    const entry = result.data?.[0] || result.images?.[0] || (Array.isArray(result) ? result[0] : null) || null;

    // Common: { b64_json }
    if (entry?.b64_json) {
        addRuntimeLog('info', 'Generic provider image parsed (entry.b64_json)', {
            provider: providerConfig.id,
            model: requestBody.model,
            imageDataLength: String(entry.b64_json || '').length,
        });
        return { imageData: entry.b64_json, mimeType: 'image/png' };
    }
    // Some providers return b64 field
    if (entry?.b64) {
        addRuntimeLog('info', 'Generic provider image parsed (entry.b64)', {
            provider: providerConfig.id,
            model: requestBody.model,
            imageDataLength: String(entry.b64 || '').length,
        });
        return { imageData: entry.b64, mimeType: 'image/png' };
    }
    // Some providers return url
    if (entry?.url) {
        const imgResponse = await fetch(entry.url);
        const blob = await imgResponse.blob();
        const base64 = await getBase64Async(blob);
        const parts = base64.split(',');
        addRuntimeLog('info', 'Generic provider image fetched from URL', {
            provider: providerConfig.id,
            model: requestBody.model,
            url: entry.url,
            mimeType: blob.type || 'image/png',
            imageDataLength: String(parts[1] || base64).length,
        });
        return { imageData: parts[1] || base64, mimeType: blob.type || 'image/png' };
    }

    // Try alternative top-level fields
    if (result.b64_json) {
        addRuntimeLog('info', 'Generic provider image parsed (result.b64_json)', {
            provider: providerConfig.id,
            model: requestBody.model,
            imageDataLength: String(result.b64_json || '').length,
        });
        return { imageData: result.b64_json, mimeType: 'image/png' };
    }
    if (result.b64) {
        addRuntimeLog('info', 'Generic provider image parsed (result.b64)', {
            provider: providerConfig.id,
            model: requestBody.model,
            imageDataLength: String(result.b64 || '').length,
        });
        return { imageData: result.b64, mimeType: 'image/png' };
    }

    // Nothing found
    console.error(`[${extensionName}] No image found in provider response:`, result);
    addRuntimeLog('error', 'Generic provider response missing image', {
        provider: providerConfig.id,
        model: requestBody.model,
        result,
    });
    throw new Error('No image returned from provider. Check the provider response format and endpoint.');
}

/**
 * Provider-agnostic chat request helper (used for summarization)
 */
async function sendChatRequest(settings, body) {
    const providerConfig = getProviderConfig(settings);
    const chatUrl = providerConfig.chatUrl || settings.api_endpoint;
    if (!chatUrl) throw new Error('No chat endpoint configured for selected provider.');

    const headers = {
        'Content-Type': 'application/json',
    };
    // Add auth header if API key exists (Pollinations doesn't require one)
    const apiKey = getCurrentApiKey();
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (providerConfig.noApiKeyRequired) {
        // For providers like Pollinations that don't need API key, use a dummy key
        headers['Authorization'] = 'Bearer dummy';
    }
    addRuntimeLog('debug', 'Sending chat request', {
        provider: providerConfig.id,
        chatUrl,
        body,
    });

    console.log(`[${extensionName}] Sending chat request to ${chatUrl}`);
    const response = await fetch(chatUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    addRuntimeLog('debug', 'Chat response status', {
        provider: providerConfig.id,
        chatUrl,
        status: response.status,
        ok: response.ok,
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${extensionName}] Chat API Error:`, response.status, errorText);
        addRuntimeLog('error', 'Chat request failed', {
            provider: providerConfig.id,
            chatUrl,
            status: response.status,
            errorText,
        });
        throw new Error(`Chat API Error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    addRuntimeLog('debug', 'Chat response payload', {
        provider: providerConfig.id,
        chatUrl,
        result,
    });
    return result;
}


function addToGallery(imageData, prompt, messageId = null) {
    const settings = extension_settings[extensionName];
    if (!settings.gallery) settings.gallery = [];

    settings.gallery.unshift({
        imageData,
        prompt: prompt.substring(0, 200),
        timestamp: Date.now(),
        messageId,
    });

    if (settings.gallery.length > MAX_GALLERY_SIZE) {
        settings.gallery = settings.gallery.slice(0, MAX_GALLERY_SIZE);
    }

    saveSettingsDebounced();
    renderGallery();
}

function renderGallery() {
    const gallery = extension_settings[extensionName].gallery || [];
    const container = $('#nig_gallery_container');
    const emptyMsg = $('#nig_gallery_empty');

    container.empty();
    if (gallery.length === 0) {
        emptyMsg.show();
        return;
    }
    emptyMsg.hide();

    gallery.forEach((item, i) => {
        const galleryItem = $(`
            <div class="nig_gallery_item" data-index="${i}" title="${item.prompt}">
                <img src="data:image/png;base64,${item.imageData}" />
                <div class="nig_gallery_item_overlay">
                    <i class="fa-solid fa-eye nig_gallery_view" data-index="${i}" title="View"></i>
                    <i class="fa-solid fa-trash nig_gallery_delete" data-index="${i}" title="Delete"></i>
                </div>
            </div>
        `);

        // Attach click handlers directly to the elements
        galleryItem.find('.nig_gallery_view').on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log(`[${extensionName}] View clicked for index ${i}`);
            viewGalleryImage(i);
        });

        galleryItem.find('.nig_gallery_delete').on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log(`[${extensionName}] Delete clicked for index ${i}`);
            deleteGalleryImage(i);
        });

        container.append(galleryItem);
    });
}

async function generateImage() {
    const settings = extension_settings[extensionName];
    const recentMessages = getRecentMessages(settings.message_depth || 1);
    addRuntimeLog('info', 'Quick generate requested', {
        depth: settings.message_depth || 1,
        recentMessageCount: recentMessages.length,
    });

    if (recentMessages.length === 0) {
        toastr.warning('No message found.', 'Pawtrait');
        return;
    }

    const btn = $('#nig_generate_btn');
    btn.addClass('generating').find('i').removeClass('fa-image').addClass('fa-spinner fa-spin');

    const lastMsg = recentMessages[recentMessages.length - 1];
    const sender = `${lastMsg.name}`;
    addRuntimeLog('debug', 'Quick generate using latest message', {
        sender,
        messageLength: String(lastMsg.text || '').length,
        messagePreview: String(lastMsg.text || '').substring(0, 1000),
    });

    try {
        const result = await generateImageFromPrompt(lastMsg.text, sender, null);
        if (result) {
            $('#nig_preview_image').attr('src', `data:${result.mimeType};base64,${result.imageData}`);
            $('#nig_preview_container').show();
            addToGallery(result.imageData, lastMsg.text, null);
        }
    } catch (error) {
        console.error(`[${extensionName}] Error:`, error);
        addRuntimeLog('error', 'Quick generate failed', { error });
        showErrorPopup('Generation Failed', error.message);
    } finally {
        btn.removeClass('generating').find('i').removeClass('fa-spinner fa-spin').addClass('fa-image');
    }
}

async function nigMessageButton($icon) {
    if ($icon.hasClass('nig_busy')) return;

    const context = getContext();
    const messageElement = $icon.closest('.mes');
    const messageId = Number(messageElement.attr('mesid'));
    console.log(`[${extensionName}] Quick generate clicked, mesid:`, messageId);

    const message = context.chat[messageId];
    console.log(`[${extensionName}] Message content (first 100 chars):`, message?.mes?.substring(0, 100));

    if (!message?.mes) {
        toastr.warning('No message content.', 'Pawtrait');
        return;
    }
    addRuntimeLog('info', 'Message button generate requested', {
        messageId,
        isUser: !!message.is_user,
        messageLength: String(message.mes || '').length,
        messagePreview: String(message.mes || '').substring(0, 1000),
    });

    $icon.addClass('nig_busy').removeClass('fa-palette').addClass('fa-spinner fa-spin');

    try {
        const sender = message.is_user ? (name1 || 'User') : (context.name2 || 'Character');
        const result = await generateImageFromPrompt(message.mes, sender, messageId);

        if (result) {
            const filePath = await saveBase64AsFile(result.imageData, extensionName, `nig_${Date.now()}`, 'png');

            if (!message.extra) message.extra = {};
            if (!Array.isArray(message.extra.media)) message.extra.media = [];
            if (!message.extra.media_display) message.extra.media_display = MEDIA_DISPLAY.GALLERY;

            message.extra.media.push({
                url: filePath,
                type: MEDIA_TYPE.IMAGE,
                title: message.mes.substring(0, 100),
                source: MEDIA_SOURCE.GENERATED,
                skipPrompt: true,
            });
            message.extra.media_index = message.extra.media.length - 1;
            message.extra.inline_image = true;

            appendMediaToMessage(message, messageElement, SCROLL_BEHAVIOR.KEEP);
            await saveChatConditional();
            addToGallery(result.imageData, message.mes, messageId);
        }
    } catch (error) {
        console.error(`[${extensionName}] Error:`, error);
        addRuntimeLog('error', 'Message button generate failed', {
            messageId,
            error,
        });
        showErrorPopup('Generation Failed', error.message);
    } finally {
        $icon.removeClass('nig_busy fa-spinner fa-spin').addClass('fa-palette');
    }
}

async function slashCommandHandler(args, prompt) {
    const trimmedPrompt = String(prompt).trim();
    if (!trimmedPrompt) {
        toastr.warning('Please provide a prompt.', 'Pawtrait');
        return '';
    }
    addRuntimeLog('info', 'Slash command generate requested', {
        promptLength: trimmedPrompt.length,
        promptPreview: trimmedPrompt.substring(0, 1000),
    });

    try {
        const result = await generateImageFromPrompt(trimmedPrompt, null, null);
        if (result) {
            $('#nig_preview_image').attr('src', `data:${result.mimeType};base64,${result.imageData}`);
            $('#nig_preview_container').show();
            addToGallery(result.imageData, trimmedPrompt, null);
            return `data:${result.mimeType};base64,${result.imageData}`;
        }
    } catch (error) {
        addRuntimeLog('error', 'Slash command generate failed', { error });
        showErrorPopup('Generation Failed', error.message);
    }
    return '';
}

function injectMessageButton(messageId) {
    const el = $(`.mes[mesid="${messageId}"]`);
    if (el.length === 0) return;

    const buttons = el.find('.extraMesButtons');
    if (buttons.length === 0 || buttons.find('.nig_message_edit').length > 0) return;

    // Edit & generate button (paw icon)
    const editBtn = $(`<div title="Pawtrait 🐾" class="mes_button nig_message_edit fa-solid fa-paw"></div>`);

    const after = buttons.find('.cig_message_gen, .sd_message_gen').first();
    if (after.length) {
        after.after(editBtn);
    } else {
        buttons.prepend(editBtn);
    }
}

function injectAllMessageButtons() {
    $('.mes').each(function() {
        const id = $(this).attr('mesid');
        if (id !== undefined) injectMessageButton(Number(id));
    });
}

function clearGallery() {
    if (!confirm('Clear the gallery?')) return;
    addRuntimeLog('info', 'Gallery cleared');
    extension_settings[extensionName].gallery = [];
    saveSettingsDebounced();
    renderGallery();
    toastr.info('Gallery cleared.', 'Pawtrait');
}

function viewGalleryImage(index) {
    console.log(`[${extensionName}] viewGalleryImage called with index:`, index);

    const gallery = extension_settings[extensionName].gallery;
    console.log(`[${extensionName}] Gallery length:`, gallery?.length);
    console.log(`[${extensionName}] Gallery:`, gallery);

    const item = gallery?.[index];
    console.log(`[${extensionName}] Item at index:`, item ? 'found' : 'not found');

    if (!item) {
        console.log(`[${extensionName}] viewGalleryImage: No item at index ${index}`);
        return;
    }

    console.log(`[${extensionName}] viewGalleryImage: Opening image at index ${index}`);
    console.log(`[${extensionName}] Item timestamp:`, item.timestamp);
    console.log(`[${extensionName}] Item prompt:`, item.prompt?.substring(0, 50));
    console.log(`[${extensionName}] Item imageData length:`, item.imageData?.length);

    // Remove any existing popup first
    $('.nig_popup_overlay').remove();

    const popup = $(`
        <div class="nig_popup_overlay">
            <div class="nig_popup">
                <div class="nig_popup_header">
                    <span>${new Date(item.timestamp).toLocaleString()}</span>
                    <i class="fa-solid fa-xmark nig_popup_close"></i>
                </div>
                <img src="data:image/png;base64,${item.imageData}" />
                <div class="nig_popup_prompt">${item.prompt}</div>
            </div>
        </div>
    `);

    $('body').append(popup);
    console.log(`[${extensionName}] viewGalleryImage: Popup appended to body`);
    console.log(`[${extensionName}] Popup element in DOM:`, $('.nig_popup_overlay').length);

    // Attach close handlers after a small delay to prevent immediate closure
    setTimeout(() => {
        // Close on X button click/tap
        popup.find('.nig_popup_close').on('click', function(e) {
            e.stopPropagation();
            popup.remove();
        });

        // Close on overlay click (but not on popup content)
        popup.on('click', function(e) {
            if ($(e.target).hasClass('nig_popup_overlay')) {
                popup.remove();
            }
        });
    }, 100);
}

function deleteGalleryImage(index) {
    // Show confirmation popup
    const popup = $(`
        <div class="nig_popup_overlay">
            <div class="nig_confirm_popup">
                <div class="nig_confirm_header">
                    <i class="fa-solid fa-trash"></i>
                    <span>Delete Image?</span>
                </div>
                <div class="nig_confirm_body">
                    Are you sure you want to delete this image from the gallery?
                </div>
                <div class="nig_confirm_footer">
                    <div class="menu_button nig_confirm_cancel">Cancel</div>
                    <div class="menu_button nig_confirm_delete">Delete</div>
                </div>
            </div>
        </div>
    `);

    popup.on('click', '.nig_confirm_cancel', function() {
        popup.remove();
    });

    popup.on('click', '.nig_confirm_delete', function() {
        extension_settings[extensionName].gallery.splice(index, 1);
        saveSettingsDebounced();
        renderGallery();
        popup.remove();
        toastr.info('Image deleted.', 'Pawtrait');
    });

    popup.on('click', function(e) {
        if ($(e.target).hasClass('nig_popup_overlay')) {
            popup.remove();
        }
    });

    $('body').append(popup);
}

async function showEditGeneratePopup(messageId) {
    const context = getContext();
    const settings = extension_settings[extensionName];
    console.log(`[${extensionName}] showEditGeneratePopup called with messageId:`, messageId);
    console.log(`[${extensionName}] Chat length:`, context.chat?.length);

    const message = context.chat[messageId];
    console.log(`[${extensionName}] Message at index ${messageId}:`, message?.mes?.substring(0, 100));

    if (!message?.mes) {
        toastr.warning('No message content found.', 'Pawtrait');
        return;
    }
    addRuntimeLog('info', 'Opened Edit & Generate popup', {
        messageId,
        messageLength: String(message.mes || '').length,
        messagePreview: String(message.mes || '').substring(0, 1000),
        model: settings.model,
        provider: settings.provider,
    });
    const charName = context.name2 || 'Character';
    const userName = name1 || 'User';

    // Get the full cleaned message (no truncation)
    const fullCleanedMessage = cleanText(message.mes);

    // Build the initial prompt with full message
    let initialPrompt = '';
    if (settings.system_instruction) {
        initialPrompt = settings.system_instruction + '\n\n';
    }
    initialPrompt += fullCleanedMessage;

    // Get avatars
    const charAvatar = await getCharacterAvatar();
    const userAvatar = await getUserAvatar();

    // Active characters can be used as extra references in Edit & Generate
    const activeCharNames = getActiveCharacterNames().filter(name => name && name !== charName);
    const activeCharacterRefs = (await Promise.all(activeCharNames.map(async (name) => {
        const avatar = await getCharacterAvatarByName(name);
        const description = getEffectiveCharacterDescriptionByName(name);
        return { name, avatar, description };
    }))).filter(item => item.avatar || item.description);

    const hasAnyReferenceOption = !!charAvatar || !!userAvatar || activeCharacterRefs.length > 0 || settings.gallery?.length > 0;
    const activeReferenceOptionsHtml = activeCharacterRefs.map(ref => `
        <label class="nig_avatar_option nig_active_avatar_option">
            <input type="checkbox" class="nig_include_active_char" data-char-name="${ref.name}" />
            ${ref.avatar ? `<img src="data:${ref.avatar.mimeType};base64,${ref.avatar.data}" />` : '<div class="nig_avatar_placeholder"><i class="fa-solid fa-user"></i></div>'}
            <span>${ref.name}</span>
        </label>
    `).join('');

    const popup = $(`
        <div class="nig_edit_overlay">
            <div class="nig_edit_popup">
                <div class="nig_edit_header">
                    <span><i class="fa-solid fa-wand-magic-sparkles"></i> Edit & Generate</span>
                    <i class="fa-solid fa-xmark nig_edit_close"></i>
                </div>
                <div class="nig_edit_body">
                    <div class="nig_edit_section">
                        <label>Prompt</label>
                        <textarea id="nig_edit_prompt" class="text_pole" rows="8">${initialPrompt}</textarea>
                        <div class="nig_edit_prompt_actions">
                            <small class="nig_hint">Characters: <span id="nig_edit_char_count">${initialPrompt.length}</span></small>
                            <div class="nig_edit_buttons">
                                <div id="nig_summarize_btn" class="menu_button menu_button_icon nig_small_btn" title="Use AI to create image prompt">
                                    <i class="fa-solid fa-robot"></i> Summarize
                                </div>
                                <div id="nig_reset_prompt_btn" class="menu_button menu_button_icon nig_small_btn" title="Reset to original">
                                    <i class="fa-solid fa-rotate-left"></i>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="nig_edit_section">
                        <label>Include Reference Images</label>
                        <div class="nig_avatar_options">
                            ${charAvatar ? `
                            <label class="nig_avatar_option">
                                <input type="checkbox" id="nig_include_char" checked />
                                <img src="data:${charAvatar.mimeType};base64,${charAvatar.data}" />
                                <span>${charName}</span>
                            </label>
                            ` : ''}
                            ${userAvatar ? `
                            <label class="nig_avatar_option">
                                <input type="checkbox" id="nig_include_user" />
                                <img src="data:${userAvatar.mimeType};base64,${userAvatar.data}" />
                                <span>${userName}</span>
                            </label>
                            ` : ''}
                            ${activeReferenceOptionsHtml}
                            ${settings.gallery?.length > 0 ? `
                            <label class="nig_avatar_option">
                                <input type="checkbox" id="nig_include_prev" />
                                <img src="data:image/png;base64,${settings.gallery[0].imageData}" />
                                <span>Previous</span>
                                </label>
                            ` : ''}
                        </div>
                        ${activeCharacterRefs.length > 0 ? '<small class="nig_hint">Selected active characters also add their visual descriptions to the prompt.</small>' : ''}
                        ${!hasAnyReferenceOption ? '<small class="nig_hint">No avatars available</small>' : ''}
                        <small class="nig_hint nig_warning">⚠️ Reference images only work with compatible models (flux-kontext, gpt-4o-image, etc.)</small>
                    </div>

                    <div class="nig_edit_section">
                        <label>Model: <strong>${settings.model}</strong></label>
                    </div>
                </div>
                <div class="nig_edit_footer">
                    <div class="menu_button nig_edit_cancel">Cancel</div>
                    <div class="menu_button menu_button_icon nig_edit_generate">
                        <i class="fa-solid fa-image"></i>
                        <span>Generate</span>
                    </div>
                </div>
            </div>
        </div>
    `);

    // Store original message for reset
    const originalMessage = message.mes;

    // Update char count on input
    popup.find('#nig_edit_prompt').on('input', function() {
        popup.find('#nig_edit_char_count').text($(this).val().length);
    });

    // Reset prompt button
    popup.find('#nig_reset_prompt_btn').on('click', function(e) {
        e.stopPropagation();
        const resetPrompt = settings.system_instruction ? settings.system_instruction + '\n\n' : '';
        popup.find('#nig_edit_prompt').val(resetPrompt + cleanText(originalMessage));
        popup.find('#nig_edit_char_count').text(popup.find('#nig_edit_prompt').val().length);
    });

    // Summarize with AI button
    popup.find('#nig_summarize_btn').on('click', async function(e) {
        e.stopPropagation();

        const btn = $(this);
        // Prevent double-firing
        if (btn.hasClass('disabled')) return;
        btn.addClass('disabled');

        btn.find('i').removeClass('fa-robot').addClass('fa-spinner fa-spin');
        btn.css('pointer-events', 'none');

        try {
            const selectedAdditionalCharacters = [];
            popup.find('.nig_include_active_char:checked').each(function() {
                const activeName = String($(this).attr('data-char-name') || '').trim();
                if (!activeName) return;

                const activeRef = activeCharacterRefs.find(ref => ref.name === activeName);
                if (!activeRef) return;

                selectedAdditionalCharacters.push({
                    name: activeName,
                    description: activeRef.description || '',
                });
            });
            addRuntimeLog('debug', 'Edit popup summarize requested', {
                messageId,
                additionalCharacters: selectedAdditionalCharacters.map(item => item.name),
            });

            const summary = await summarizeWithAI(originalMessage, charName, userName, selectedAdditionalCharacters);
            let newPrompt = settings.system_instruction ? settings.system_instruction + '\n\n' : '';
            newPrompt += summary;
            popup.find('#nig_edit_prompt').val(newPrompt);
            popup.find('#nig_edit_char_count').text(newPrompt.length);
            toastr.success('Prompt summarized!', 'Pawtrait');
        } catch (error) {
            console.error(`[${extensionName}] Summarize error:`, error);
            addRuntimeLog('error', 'Edit popup summarize failed', {
                messageId,
                error,
            });
            toastr.error(`Summarize failed: ${error.message}`, 'Pawtrait');
        } finally {
            btn.find('i').removeClass('fa-spinner fa-spin').addClass('fa-robot');
            btn.css('pointer-events', '');
            btn.removeClass('disabled');
        }
    });

    // Close handlers
    popup.on('click', '.nig_edit_close, .nig_edit_cancel', function(e) {
        e.stopPropagation();
        popup.remove();
    });

    // Generate handler
    popup.on('click', '.nig_edit_generate', async function(e) {
        e.stopPropagation();

        // Prevent double-firing
        const btn = $(this);
        if (btn.hasClass('disabled')) return;
        btn.addClass('disabled');

        const promptText = popup.find('#nig_edit_prompt').val().trim();

        if (!promptText) {
            toastr.warning('Please enter a prompt.', 'Pawtrait');
            btn.removeClass('disabled');
            return;
        }

        btn.find('i').removeClass('fa-image').addClass('fa-spinner fa-spin');
        btn.css('pointer-events', 'none');

        try {
            // Build custom image data URLs based on selections
            let finalPrompt = promptText;
            const imageDataUrls = [];

            if (popup.find('#nig_include_char').prop('checked') && charAvatar) {
                imageDataUrls.push(`data:${charAvatar.mimeType};base64,${charAvatar.data}`);
            }
            if (popup.find('#nig_include_user').prop('checked') && userAvatar) {
                imageDataUrls.push(`data:${userAvatar.mimeType};base64,${userAvatar.data}`);
            }
            if (popup.find('#nig_include_prev').prop('checked') && settings.gallery?.length > 0) {
                imageDataUrls.push(`data:image/png;base64,${settings.gallery[0].imageData}`);
            }

            // Add active character references and descriptions
            const selectedActiveNames = [];
            popup.find('.nig_include_active_char:checked').each(function() {
                const activeName = String($(this).attr('data-char-name') || '').trim();
                if (activeName) selectedActiveNames.push(activeName);
            });

            if (selectedActiveNames.length > 0) {
                const activeDescriptionParts = [];

                for (const activeName of selectedActiveNames) {
                    const activeRef = activeCharacterRefs.find(ref => ref.name === activeName);
                    if (!activeRef) continue;

                    if (activeRef.avatar) {
                        imageDataUrls.push(`data:${activeRef.avatar.mimeType};base64,${activeRef.avatar.data}`);
                    }
                    if (activeRef.description) {
                        activeDescriptionParts.push(`${activeName}: ${activeRef.description}`);
                    }
                }

                if (activeDescriptionParts.length > 0) {
                    finalPrompt = `${promptText}\n\nReference characters:\n${activeDescriptionParts.join('\n\n')}`;
                }
            }
            addRuntimeLog('debug', 'Edit popup generate payload assembled', {
                messageId,
                selectedActiveNames,
                referenceImageCount: imageDataUrls.length,
                finalPromptLength: finalPrompt.length,
                finalPrompt,
            });

            // Generate with custom prompt and selected images
            const result = await generateImageWithOptions(finalPrompt, imageDataUrls);

            if (result) {
                // Save to message
                const messageElement = $(`.mes[mesid="${messageId}"]`);
                const filePath = await saveBase64AsFile(result.imageData, extensionName, `nig_${Date.now()}`, 'png');

                if (!message.extra) message.extra = {};
                if (!Array.isArray(message.extra.media)) message.extra.media = [];
                if (!message.extra.media_display) message.extra.media_display = MEDIA_DISPLAY.GALLERY;

                message.extra.media.push({
                    url: filePath,
                    type: MEDIA_TYPE.IMAGE,
                    title: finalPrompt.substring(0, 100),
                    source: MEDIA_SOURCE.GENERATED,
                    skipPrompt: true,
                });
                message.extra.media_index = message.extra.media.length - 1;
                message.extra.inline_image = true;

                appendMediaToMessage(message, messageElement, SCROLL_BEHAVIOR.KEEP);
                await saveChatConditional();
                addToGallery(result.imageData, finalPrompt, messageId);

                popup.remove();
                toastr.success('Image generated!', 'Pawtrait');
            }
        } catch (error) {
            console.error(`[${extensionName}] Error:`, error);
            addRuntimeLog('error', 'Edit popup generate failed', {
                messageId,
                error,
            });
            showErrorPopup('Generation Failed', error.message);
        } finally {
            btn.find('i').removeClass('fa-spinner fa-spin').addClass('fa-image');
            btn.css('pointer-events', '');
            btn.removeClass('disabled');
        }
    });

    // Remove any existing edit popup first
    $('.nig_edit_overlay').remove();

    $('body').append(popup);
    console.log(`[${extensionName}] showEditGeneratePopup: Popup appended to body`);

    // Attach overlay close handler after a small delay to prevent immediate closure
    setTimeout(() => {
        popup.on('click', function(e) {
            if ($(e.target).hasClass('nig_edit_overlay')) {
                popup.remove();
            }
        });
    }, 100);
}

async function generateImageWithOptions(promptText, imageDataUrls = []) {
    const settings = extension_settings[extensionName];
    addRuntimeLog('info', 'Edit popup generate requested', {
        provider: settings.provider,
        model: settings.model,
        promptLength: String(promptText || '').length,
        referenceImageCount: Array.isArray(imageDataUrls) ? imageDataUrls.length : 0,
        promptPreview: String(promptText || '').substring(0, 1500),
    });

    if (!getCurrentApiKey()) {
        throw new Error('API Key is not set.');
    }

    const selectedAspectRatio = getEffectiveAspectRatioForModel(settings.aspect_ratio, settings.model);
    const modelProfile = getModelRuntimeProfile(settings.model);
    const effectiveSizeOption = getEffectiveModelSizeOption(modelProfile, settings.image_size, selectedAspectRatio);
    const requestSize = isDimensionImageSizeValue(effectiveSizeOption)
        ? normalizeImageDimensionValue(effectiveSizeOption)
        : getModelRequestSize(modelProfile, selectedAspectRatio);

    const requestBody = {
        model: settings.model,
        prompt: promptText,
        n: 1,
        size: requestSize,
        aspect_ratio: selectedAspectRatio,
        response_format: 'b64_json',
    };

    if (effectiveSizeOption && isTierImageSizeValue(effectiveSizeOption)) {
        requestBody.image_size = effectiveSizeOption;
    }

    // Add images to request
    if (imageDataUrls.length === 1) {
        requestBody.imageDataUrl = imageDataUrls[0];
    } else if (imageDataUrls.length > 1) {
        requestBody.imageDataUrls = imageDataUrls;
    }
    addRuntimeLog('debug', 'Edit popup request prepared', {
        provider: settings.provider,
        model: settings.model,
        requestBody,
    });

    console.log(`[${extensionName}] Calling provider image endpoint`);

    const result = await sendImageRequest(settings, requestBody);
    if (result?.imageData) {
        addRuntimeLog('info', 'Edit popup generate succeeded', {
            model: settings.model,
            mimeType: result.mimeType || 'image/png',
            imageDataLength: String(result.imageData || '').length,
        });
        return { imageData: result.imageData, mimeType: result.mimeType || 'image/png' };
    }

    throw new Error('No image returned from API.');
}


jQuery(async () => {
    console.log(`[${extensionName}] Initializing...`);
    addRuntimeLog('info', 'Pawtrait extension initializing');

    try {
        // Load settings template relative to this script so it works even if the
        // extension folder name differs in case (Linux is case-sensitive).
        const templateUrl = new URL('settings.html', import.meta.url);
        const response = await fetch(templateUrl);
        if (!response.ok) throw new Error(`Failed to load template`);
        $('#extensions_settings').append(await response.text());
    } catch (error) {
        console.error(`[${extensionName}] Error:`, error);
        addRuntimeLog('error', 'Failed to load settings template', { error });
        toastr.error('Failed to load settings.', 'Pawtrait');
        return;
    }

    await loadSettings();
    addRuntimeLog('info', 'Settings loaded', {
        provider: extension_settings[extensionName].provider,
        model: extension_settings[extensionName].model,
        summarizer: extension_settings[extensionName].summarizer_model,
    });

    // Delayed refresh of character dropdown to ensure characters are loaded
    setTimeout(populateCharacterDropdown, 1000);
    setTimeout(populateActiveCharacterDropdown, 1100);
    setTimeout(updateActiveCharactersList, 1200);

    // Tab Navigation
    $('.nig_tab').on('click', function() {
        const tab = $(this).data('tab');
        $('.nig_tab').removeClass('active');
        $(this).addClass('active');
        $('.nig_tab_content').removeClass('active');
        $(`.nig_tab_content[data-tab="${tab}"]`).addClass('active');
        if (tab === 'logs') {
            renderRuntimeLogs();
        }
    });

    $('#nig_log_level_filter').on('change', function() {
        renderRuntimeLogs({ suppressAutoscroll: true });
    });

    $('#nig_logs_list').on('wheel', function(e) {
        const evt = e.originalEvent;
        if (!evt) return;

        const deltaY = Number(evt.deltaY) || 0;
        if (deltaY === 0) return;

        const el = this;
        const before = el.scrollTop;
        el.scrollTop += deltaY;
        const changed = el.scrollTop !== before;

        if (changed) {
            e.preventDefault();
            e.stopPropagation();
        }
    });

    $('#nig_logs_list').on('click', '.nig_log_toggle', function() {
        const id = Number($(this).attr('data-log-id'));
        if (!Number.isFinite(id)) return;

        if (runtimeExpandedLogIds.has(id)) {
            runtimeExpandedLogIds.delete(id);
        } else {
            runtimeExpandedLogIds.add(id);
        }

        renderRuntimeLogs();
    });

    $('#nig_log_autoscroll').on('change', function() {
        extension_settings[extensionName].log_autoscroll = $(this).prop('checked');
        saveSettingsDebounced();
        renderRuntimeLogs();
    });

    $('#nig_clear_logs').on('click', function() {
        clearRuntimeLogs();
        toastr.info('Logs cleared.', 'Pawtrait');
    });

    $('#nig_copy_logs').on('click', async function() {
        try {
            await copyRuntimeLogsToClipboard();
            toastr.success('Logs copied to clipboard.', 'Pawtrait');
            addRuntimeLog('info', 'Runtime logs copied to clipboard');
        } catch (error) {
            toastr.error(`Failed to copy logs: ${error.message}`, 'Pawtrait');
            addRuntimeLog('error', 'Failed to copy runtime logs', { error });
        }
    });

    // API Settings
    $('#nig_api_endpoint').on('input', function() {
        const endpoint = String($(this).val()).trim();
        extension_settings[extensionName].api_endpoint = endpoint;

        // Keep custom endpoint persisted when switching providers
        if (extension_settings[extensionName].provider === 'custom') {
            extension_settings[extensionName].custom_api_endpoint = endpoint;
        }

        saveSettingsDebounced();
    });

    $('#nig_api_key').on('input', function() {
        const key = String($(this).val()).trim();
        setCurrentApiKey(key);
        saveSettingsDebounced();
    });

    // Provider selection
    $('#nig_provider').on('change', async function() {
        const previousProvider = extension_settings[extensionName].provider;

        // Save custom endpoint before switching away from custom provider
        if (previousProvider === 'custom') {
            extension_settings[extensionName].custom_api_endpoint = extension_settings[extensionName].api_endpoint || '';
        }

        const v = $(this).val();
        extension_settings[extensionName].provider = v;
        addRuntimeLog('info', 'Provider changed', {
            previousProvider,
            provider: v,
        });

        // Show/hide endpoint URL field (only for custom)
        if (v === 'custom') {
            $('#nig_endpoint_field').show();
        } else {
            $('#nig_endpoint_field').hide();
        }

        // Set the correct API endpoint for the selected provider
        if (v === 'nano-gpt') {
            extension_settings[extensionName].api_endpoint = 'https://nano-gpt.com/v1/images/generations';
        } else if (v === 'openrouter') {
            extension_settings[extensionName].api_endpoint = 'https://openrouter.ai/api/v1/chat/completions';
        } else if (v === 'linkapi') {
            extension_settings[extensionName].api_endpoint = 'https://api.linkapi.ai/v1/images/generations';
        } else if (v === 'pollinations') {
            extension_settings[extensionName].api_endpoint = 'https://gen.pollinations.ai/image/';
        } else if (v === 'custom') {
            extension_settings[extensionName].api_endpoint = extension_settings[extensionName].custom_api_endpoint || '';
        }

        // Keep endpoint field synchronized with active provider endpoint
        $('#nig_api_endpoint').val(extension_settings[extensionName].api_endpoint || '');

        // Update API key field to show the key for the new provider
        $('#nig_api_key').val(getCurrentApiKey());

        // Clear model dropdown and fetch models for new provider
        extension_settings[extensionName].model = '';
        $('#nig_model').empty().append('<option value="">-- Click Fetch Models --</option>');
        updateGenerationControlOptions('');
        updateModelInfo();

        // Fetch models if API key exists or provider doesn't require one
        const providerConfig = getProviderConfig(extension_settings[extensionName]);
        if (getCurrentApiKey() || providerConfig.noApiKeyRequired) {
            await fetchModelsFromAPI(false);
            await fetchSummarizerModelsFromAPI(true);
        }

        saveSettingsDebounced();
    });

    // Toggle API key visibility
    $('#nig_toggle_key').on('click', function() {
        const input = $('#nig_api_key');
        const icon = $(this).find('i');
        if (input.attr('type') === 'password') {
            input.attr('type', 'text');
            icon.removeClass('fa-eye').addClass('fa-eye-slash');
        } else {
            input.attr('type', 'password');
            icon.removeClass('fa-eye-slash').addClass('fa-eye');
        }
    });

    $('#nig_model').on('change', function() {
        const selectedModel = $(this).val();
        extension_settings[extensionName].model = selectedModel;
        addRuntimeLog('info', 'Generation model changed', {
            provider: extension_settings[extensionName].provider,
            model: selectedModel,
        });
        updateGenerationControlOptions(selectedModel);
        updateModelInfo();
        saveSettingsDebounced();
    });

    $('#nig_summarizer_model').on('change', function() {
        extension_settings[extensionName].summarizer_model = $(this).val();
        addRuntimeLog('info', 'Summarizer model changed', {
            model: extension_settings[extensionName].summarizer_model,
        });
        saveSettingsDebounced();
    });

    $('#nig_auto_summarize').on('change', function() {
        extension_settings[extensionName].auto_summarize = $(this).prop('checked');
        addRuntimeLog('info', 'Auto-summarize toggled', {
            enabled: extension_settings[extensionName].auto_summarize,
        });
        saveSettingsDebounced();
    });

    $('#nig_fetch_models_btn').on('click', fetchModelsFromAPI);
    $('#nig_fetch_summarizer_models_btn').on('click', function() { fetchSummarizerModelsFromAPI(false); });

    // Character Description Settings
    $('#nig_char_select').on('change', function() {
        const charName = $(this).val();
        loadCharacterDescription(charName);
    });

    $('#nig_save_char_desc_btn').on('click', saveCharacterDescription);

    $('#nig_reset_char_desc_btn').on('click', resetCharacterDescription);

    $('#nig_refresh_chars_btn').on('click', function() {
        populateCharacterDropdown();
        populateActiveCharacterDropdown();
        updateActiveCharactersList();
        updateSavedCharactersList();
    });

    $('#nig_add_active_char_btn').on('click', function() {
        const selectedName = $('#nig_active_char_select').val();
        if (!selectedName) {
            toastr.info('Select a character first.', 'Pawtrait');
            return;
        }

        if (addActiveCharacter(selectedName)) {
            toastr.success(`Added ${selectedName} to active characters`, 'Pawtrait');
            $('#nig_active_char_select').val('');
        }
    });

    $(document).on('click', '.nig_remove_active_char', function() {
        const name = $(this).data('name');
        if (!name) return;
        removeActiveCharacter(name);
        toastr.info(`Removed ${name} from active characters`, 'Pawtrait');
    });

    // Edit character description from saved list
    $(document).on('click', '.nig_edit_char_desc', function() {
        const name = $(this).data('name');
        if (name) {
            $('#nig_char_select').val(name);
            loadCharacterDescription(name);
            // Scroll to top of Characters tab
            $('.nig_tab_content[data-tab="characters"]').scrollTop(0);
        }
    });

    // Delete character description
    $(document).on('click', '.nig_delete_char_desc', function() {
        const name = $(this).data('name');
        if (name && confirm(`Delete custom description for "${name}"?`)) {
            delete extension_settings[extensionName].char_descriptions[name];
            saveSettingsDebounced();
            updateSavedCharactersList();
            updateActiveCharactersList();

            // Reload if this was the selected character
            if ($('#nig_char_select').val() === name) {
                loadCharacterDescription(name);
            }

            toastr.info(`Deleted custom description for ${name}`, 'Pawtrait');
        }
    });

    // Persona Description Settings
    $('#nig_persona_select').on('change', function() {
        const personaKey = $(this).val();
        loadPersonaDescription(personaKey);
    });

    $('#nig_save_persona_desc_btn').on('click', savePersonaDescription);

    $('#nig_reset_persona_desc_btn').on('click', resetPersonaDescription);

    $('#nig_refresh_personas_btn').on('click', function() {
        populatePersonaDropdown();
        updateSavedPersonasList();
    });

    // Edit persona description from saved list
    $(document).on('click', '.nig_edit_persona_desc', function() {
        const key = $(this).data('key');
        if (key) {
            $('#nig_persona_select').val(key);
            loadPersonaDescription(key);
            // Scroll to top of Characters tab
            $('.nig_tab_content[data-tab="characters"]').scrollTop(0);
        }
    });

    // Delete persona description
    $(document).on('click', '.nig_delete_persona_desc', function() {
        const key = $(this).data('key');
        const name = power_user.personas?.[key] || key;
        if (key && confirm(`Delete custom description for "${name}"?`)) {
            delete extension_settings[extensionName].persona_descriptions[key];
            saveSettingsDebounced();
            updateSavedPersonasList();

            // Reload if this was the selected persona
            if ($('#nig_persona_select').val() === key) {
                loadPersonaDescription(key);
            }

            toastr.info(`Deleted custom description for ${name}`, 'Pawtrait');
        }
    });

    // Test Connection
    $('#nig_test_connection_btn').on('click', async function() {
        const settings = extension_settings[extensionName];
        const statusEl = $('#nig_connection_status');
        const btn = $(this);

        if (!getCurrentApiKey()) {
            statusEl.removeClass('connected').addClass('error');
            statusEl.find('.nig_status_text').text('No API key');
            return;
        }

        btn.find('i').removeClass('fa-plug-circle-check').addClass('fa-spinner fa-spin');
        statusEl.removeClass('connected error');
        statusEl.find('.nig_status_text').text('Testing...');

        try {
            // Simple test - try provider-specific models endpoint or the configured API endpoint
            const providerConfig = getProviderConfig(settings);
            const testUrl = providerConfig.modelsTestUrl || providerConfig.modelsUrl || settings.api_endpoint;

            if (!testUrl) {
                statusEl.addClass('error');
                statusEl.find('.nig_status_text').text('No test endpoint');
                toastr.error('No test endpoint available for selected provider.', 'Pawtrait');
                return;
            }

            const response = await fetch(testUrl, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${getCurrentApiKey()}` },
            });

            if (response.ok) {
                statusEl.addClass('connected');
                statusEl.find('.nig_status_text').text('Connected');
                toastr.success('Connection successful!', 'Pawtrait');
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            statusEl.addClass('error');
            statusEl.find('.nig_status_text').text('Connection failed');
            toastr.error(`Connection failed: ${error.message}`, 'Pawtrait');
        } finally {
            btn.find('i').removeClass('fa-spinner fa-spin').addClass('fa-plug-circle-check');
        }
    });

    // Generation Settings
    $('#nig_aspect_ratio').on('change', function() {
        const settings = extension_settings[extensionName];
        const selected = normalizeAspectRatioValue($(this).val());
        const effective = getEffectiveAspectRatioForModel(selected, settings.model);
        $(this).val(effective);
        settings.aspect_ratio = effective;
        saveSettingsDebounced();
    });

    $('#nig_image_size').on('change', function() {
        const settings = extension_settings[extensionName];
        const profile = getModelRuntimeProfile(settings.model);
        const allowed = getModelImageSizeOptions(profile);
        if (allowed.length === 0) {
            $('#nig_image_size_field').hide();
            return;
        }

        const requested = normalizeImageSizeOptionValue($(this).val());
        const imageSize = requested && allowed.includes(requested)
            ? requested
            : getEffectiveModelSizeOption(profile, settings.image_size, settings.aspect_ratio);
        $(this).val(imageSize);
        settings.image_size = imageSize;
        saveSettingsDebounced();
    });

    $('#nig_max_prompt_length').on('change', function() {
        let v = parseInt($(this).val(), 10);
        if (isNaN(v) || v < 100) v = 100;
        if (v > 5000) v = 5000;
        $(this).val(v);
        extension_settings[extensionName].max_prompt_length = v;
        saveSettingsDebounced();
    });

    $('#nig_use_avatars').on('change', function() {
        extension_settings[extensionName].use_avatars = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#nig_include_descriptions').on('change', function() {
        extension_settings[extensionName].include_descriptions = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#nig_use_previous_image').on('change', function() {
        extension_settings[extensionName].use_previous_image = $(this).prop('checked');
        saveSettingsDebounced();
    });

    // Message depth slider
    $('#nig_message_depth').on('input', function() {
        $('#nig_message_depth_value').text($(this).val());
    });

    $('#nig_message_depth').on('change', function() {
        let v = parseInt($(this).val(), 10);
        if (isNaN(v) || v < 1) v = 1;
        if (v > 10) v = 10;
        $(this).val(v);
        $('#nig_message_depth_value').text(v);
        extension_settings[extensionName].message_depth = v;
        saveSettingsDebounced();
    });

    $('#nig_system_instruction').on('input', function() {
        extension_settings[extensionName].system_instruction = $(this).val();
        saveSettingsDebounced();
    });

    $('#nig_reset_instruction').on('click', function() {
        extension_settings[extensionName].system_instruction = defaultSettings.system_instruction;
        $('#nig_system_instruction').val(defaultSettings.system_instruction);
        saveSettingsDebounced();
        toastr.info('Reset to default.', 'Pawtrait');
    });

    // Buttons
    $('#nig_generate_btn').on('click', generateImage);
    $('#nig_clear_gallery').on('click', clearGallery);

    // Test prompt preview button
    $('#nig_test_prompt_btn').on('click', async function() {
        const settings = extension_settings[extensionName];
        const recentMessages = getRecentMessages(settings.message_depth || 1);

        if (recentMessages.length === 0) {
            toastr.warning('No message found.', 'Pawtrait');
            return;
        }

        const lastMsg = recentMessages[recentMessages.length - 1];
        const promptText = await buildPromptText(lastMsg.text, lastMsg.name, null);

        $('#nig_prompt_preview').val(promptText);
        $('#nig_prompt_preview_block').show();
        toastr.info(`Prompt: ${promptText.length} chars`, 'Pawtrait');
    });

    // Gallery events are now attached directly in renderGallery()

    // Message edit button
    $(document).on('click', '.nig_message_edit', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const messageElement = $(this).closest('.mes');
        const messageId = Number(messageElement.attr('mesid'));
        console.log(`[${extensionName}] Edit button clicked, mesid:`, messageId);
        await showEditGeneratePopup(messageId);
    });

    // Events
    eventSource.on(event_types.MESSAGE_RENDERED, injectMessageButton);
    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(injectAllMessageButtons, 100);
        setTimeout(populateCharacterDropdown, 200);
        setTimeout(populateActiveCharacterDropdown, 250);
        updateActiveCharactersList();
        updateSavedCharactersList();
    });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => setTimeout(injectAllMessageButtons, 100));
    eventSource.on(event_types.CHAT_CREATED, () => setTimeout(injectAllMessageButtons, 100));
    eventSource.on(event_types.CHARACTER_PAGE_LOADED, () => {
        setTimeout(populateCharacterDropdown, 200);
        setTimeout(populateActiveCharacterDropdown, 250);
        updateActiveCharactersList();
    });
    eventSource.on(event_types.APP_READY, () => {
        setTimeout(populateCharacterDropdown, 500);
        setTimeout(populateActiveCharacterDropdown, 600);
        updateActiveCharactersList();
    });

    setTimeout(injectAllMessageButtons, 500);

    // Slash command
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'pawtrait',
        returns: 'Generated image URL',
        callback: slashCommandHandler,
        aliases: ['pawimg'],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Prompt',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: 'Generate image. Example: /pawtrait a sunset',
    }));

    console.log(`[${extensionName}] Loaded!`);
    addRuntimeLog('info', 'Pawtrait extension loaded');
});
