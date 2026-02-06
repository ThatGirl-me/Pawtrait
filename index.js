/**
 * Pawtrait 🐾
 * Multi-provider image generation with avatar references and character context
 * Supports NanoGPT, OpenRouter, LinkAPI.ai, Pollinations.ai, and Custom endpoints
 * Author: ThatGirl
 * Version 2.0.0
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

    // Generation Settings
    aspect_ratio: '1:1',
    max_prompt_length: 1000,
    use_avatars: false,
    include_descriptions: false,
    use_previous_image: false,
    message_depth: 1,
    system_instruction: 'Detailed illustration, high quality.',
    gallery: [],
};

const MAX_GALLERY_SIZE = 50;

/**
 * Get the API key for the currently selected provider
 */
function getCurrentApiKey() {
    const settings = extension_settings[extensionName];
    const provider = settings.provider || 'nano-gpt';

    // Try per-provider key first, fall back to legacy api_key
    if (settings.api_keys && settings.api_keys[provider]) {
        return settings.api_keys[provider];
    }
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

    // Migrate legacy api_key to per-provider keys if needed
    const s = extension_settings[extensionName];
    if (s.api_key && !s.api_keys[s.provider]) {
        s.api_keys[s.provider] = s.api_key;
    }

    $('#nig_api_endpoint').val(s.api_endpoint);
    $('#nig_api_key').val(getCurrentApiKey());  // Show current provider's key
    $('#nig_aspect_ratio').val(s.aspect_ratio);
    $('#nig_max_prompt_length').val(s.max_prompt_length);
    $('#nig_use_avatars').prop('checked', s.use_avatars);
    $('#nig_include_descriptions').prop('checked', s.include_descriptions);
    $('#nig_use_previous_image').prop('checked', s.use_previous_image);
    $('#nig_message_depth').val(s.message_depth);
    $('#nig_message_depth_value').text(s.message_depth);
    $('#nig_system_instruction').val(s.system_instruction);
    $('#nig_summarizer_model').val(s.summarizer_model);
    $('#nig_auto_summarize').prop('checked', s.auto_summarize);

    // Character description settings
    populateCharacterDropdown();
    populatePersonaDropdown();
    updateSavedCharactersList();
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

    if (!modelsUrl) {
        if (!silent) toastr.info('Model listing not available for selected provider.', 'Pawtrait');
        return;
    }

    const btn = $('#nig_fetch_summarizer_models_btn');
    if (btn.length) btn.find('i').removeClass('fa-rotate').addClass('fa-spinner fa-spin');

    try {
        const headers = { 'Accept': 'application/json' };
        if (getCurrentApiKey()) headers['Authorization'] = `Bearer ${getCurrentApiKey()}`;

        const response = await fetch(modelsUrl, { method: 'GET', headers });
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

function populateCharacterDropdown() {
    const select = $('#nig_char_select');
    const previousValue = select.val(); // Remember current selection
    select.empty();
    select.append('<option value="">-- Select a character --</option>');

    const context = getContext();
    // Try getContext().characters first, fall back to imported characters array
    let charList = context.characters;
    if (!charList || charList.length === 0) {
        charList = characters || [];
    }

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
    const context = getContext();
    let charList = context.characters;
    if (!charList || charList.length === 0) {
        charList = characters || [];
    }

    const char = charList.find(c => c.name === charName);
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
 * Get the effective character description for the current character
 * Priority: custom description > character card description
 */
function getEffectiveCharDescription() {
    const settings = extension_settings[extensionName];
    const context = getContext();

    // Get current character name
    let charList = context.characters;
    if (!charList || charList.length === 0) {
        charList = characters || [];
    }
    const currentChar = charList[context.characterId];
    const charName = currentChar?.name;

    console.log(`[${extensionName}] getEffectiveCharDescription: charName="${charName}"`);
    console.log(`[${extensionName}] Saved char_descriptions keys:`, Object.keys(settings.char_descriptions || {}));

    // First check for custom description
    if (charName && settings.char_descriptions && settings.char_descriptions[charName]) {
        console.log(`[${extensionName}] USING CUSTOM description for ${charName}`);
        return settings.char_descriptions[charName];
    }

    // Fall back to character card description
    if (currentChar?.description) {
        console.log(`[${extensionName}] Using CARD description for ${charName}`);
        return cleanText(currentChar.description).substring(0, 500);
    }

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

function supportsImageInput(model) {
    if (!model) return false;

    // Check for LinkAPI-specific flag set during filtering
    if (model._supportsImageInput === true) return true;
    if (model._supportsImageInput === false) return false;

    // Known capability flags
    if (model.capabilities?.image_to_image === true) return true;
    if (model.capabilities?.image_input === true) return true;
    if (model.capabilities?.image === true) return true;

    // Other possible fields
    if (model.supports?.image_to_image === true) return true;
    if (model.supports?.image_input === true) return true;

    // Array-based features
    if (Array.isArray(model.features) && model.features.some(f => /image|img|image_to_image|image-input|img2img/i.test(String(f)))) return true;

    // Type or name hints
    if (model.type && /image/i.test(String(model.type))) return true;

    const id = (model.id || model.name || '').toString().toLowerCase();

    // Known model name hints and configured list
    if (MODELS_WITH_IMAGE_INPUT.some(m => id.includes(m.toLowerCase()))) return true;

    const heuristics = ['image-to-image','image_to_image','img2img','kontext','gpt-image'];
    if (heuristics.some(h => id.includes(h))) {
        console.log(`[${extensionName}] supportsImageInput heuristic matched for model: ${id}`);
        return true;
    }

    return false;
}

function updateModelInfo() {
    const model = extension_settings[extensionName].model;
    const infoEl = $('#nig_model_info');

    // Check cached models first for accurate capability info
    const modelData = cachedModels.find(m => m.id === model);

    if (modelData) {
        if (supportsImageInput(modelData)) {
            infoEl.html('✅ This model supports reference images').css('color', '#5cb85c');
        } else {
            infoEl.html('⚠️ This model does NOT support reference images').css('color', '#f0ad4e');
        }
    } else {
        // Fallback to hardcoded list
        const supportsImages = MODELS_WITH_IMAGE_INPUT.some(m => model.toLowerCase().includes(m.toLowerCase()));
        if (supportsImages) {
            infoEl.html('✅ This model likely supports reference images').css('color', '#5cb85c');
        } else {
            infoEl.html('⚠️ This model may not support reference images').css('color', '#f0ad4e');
        }
    }
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

        const providerConfig = getProviderConfig(settings);
        const modelsUrl = providerConfig.modelsUrl || settings.api_endpoint;

        if (!modelsUrl) {
            if (!silent) {
                toastr.info('Model listing not available for selected provider. Please set the model manually.', 'Pawtrait');
            }
            return;
        }

        const response = await fetch(modelsUrl, {
            method: 'GET',
            headers: headers,
        });

        console.log(`[${extensionName}] Response status:`, response.status);

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
    const character = context.characters[context.characterId];
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

/**
 * Use AI to summarize scene into an image generation prompt
 */
async function summarizeWithAI(text, charName, userName) {
    const settings = extension_settings[extensionName];

    if (!getCurrentApiKey()) {
        throw new Error('API key required for summarization');
    }

    // Get character descriptions using the effective functions (respects custom overrides)
    const charDesc = getEffectiveCharDescription();
    const userDesc = getEffectiveUserDescription();

    console.log(`[${extensionName}] summarizeWithAI - charName: ${charName}, userName: ${userName}`);
    console.log(`[${extensionName}] summarizeWithAI - charDesc (first 100): ${charDesc?.substring(0, 100)}...`);
    console.log(`[${extensionName}] summarizeWithAI - userDesc (first 100): ${userDesc?.substring(0, 100)}...`);

    const systemPrompt = `You are an image prompt generator for AI art.

CHARACTER APPEARANCES (COPY THESE EXACTLY - do not paraphrase or change details):
${charName || "Character"}: ${charDesc || "No description available"}
${userName || "User"}: ${userDesc || "No description available"}

TASK:
1. Write a brief scene description (what is happening, poses, setting, lighting)
2. Then copy the EXACT character appearance details from above - do NOT summarize or change them

CRITICAL: Hair colors, gradients, lengths, and other specific details must be copied EXACTLY as written above. Do not reverse gradients or change any visual details.

Output format:
[Scene description]. [Character 1 exact appearance]. [Character 2 exact appearance].`;

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
        max_tokens: 2000,
        temperature: 0.7,
    };

    try {
        const respJson = await sendChatRequest(settings, chatBody);
        const summary = respJson.choices?.[0]?.message?.content?.trim();
        if (!summary) throw new Error('No summary returned');
        console.log(`[${extensionName}] AI Summary:`, summary);
        return summary;
    } catch (err) {
        console.error(`[${extensionName}] Summarizer error:`, err);
        const msg = (err?.message || '').toString().toLowerCase();

        // Detect model missing or provider route errors and try fallback
        if (msg.includes('model_not_found') || msg.includes('model not found') || msg.includes('503')) {
            toastr.warning(`Summarizer model "${settings.summarizer_model}" not available. Trying to find an alternative...`, 'Pawtrait');

            // Refresh chat models silently
            await fetchSummarizerModelsFromAPI(true);

            // Try to find a preferred alternative from cached models
            const candidate = findPreferredSummarizerFromCachedModels();
            if (candidate && candidate !== settings.summarizer_model) {
                extension_settings[extensionName].summarizer_model = candidate;
                saveSettingsDebounced();
                toastr.info(`Switched summarizer to ${candidate}. Retrying...`, 'Pawtrait');

                try {
                    chatBody.model = candidate;
                    const retryResp = await sendChatRequest(settings, chatBody);
                    const retrySummary = retryResp.choices?.[0]?.message?.content?.trim();
                    if (retrySummary) {
                        toastr.success('Summarizer succeeded with alternative model.', 'Pawtrait');
                        return retrySummary;
                    }
                } catch (e) {
                    console.error(`[${extensionName}] Retry summarizer error:`, e);
                    // fall through to local summary
                }
            }

            // Final fallback: local summarizer
            toastr.warning('Falling back to local summarizer.', 'Pawtrait');
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
            return finalPrompt.trim();
        } catch (error) {
            console.warn(`[${extensionName}] Auto-summarize failed, falling back to manual:`, error.message);
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
    return fullPrompt.trim();
}

async function generateImageFromPrompt(prompt, sender = null, messageId = null) {
    const settings = extension_settings[extensionName];

    if (!getCurrentApiKey()) {
        throw new Error('API Key is not set. Please enter your API key in the extension settings.');
    }
    if (!settings.api_endpoint) {
        throw new Error('API Endpoint is not set. Please enter the endpoint URL in the extension settings.');
    }

    const promptText = await buildPromptText(prompt, sender, messageId);

    // Build the request body for OpenAI-compatible image generation
    const requestBody = {
        model: settings.model,
        prompt: promptText,
        n: 1,
        size: getImageSize(settings.aspect_ratio),
        response_format: 'b64_json',
    };

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

    console.log(`[${extensionName}] Calling provider image endpoint with model: ${settings.model}`);
    console.log(`[${extensionName}] Request body:`, JSON.stringify(requestBody, null, 2));

    const result = await sendImageRequest(settings, requestBody);
    if (result?.imageData) {
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

/**
 * Send image request using Gemini native format (for LinkAPI Gemini models)
 * Uses /v1beta/models/{model}:generateContent endpoint
 */
async function sendGeminiImageRequest(settings, requestBody) {
    const modelId = requestBody.model;
    const endpoint = `https://api.linkapi.ai/v1beta/models/${modelId}:generateContent`;

    // Build Gemini-format request
    const parts = [];

    // Add text prompt
    if (requestBody.prompt) {
        parts.push({ text: requestBody.prompt });
    }

    // Add reference images if provided (for image-to-image)
    // Note: imageDataUrl/imageDataUrls are NanoGPT format, we need to convert
    const imageUrls = [];
    if (requestBody.imageDataUrl) {
        imageUrls.push(requestBody.imageDataUrl);
    }
    if (requestBody.imageDataUrls && Array.isArray(requestBody.imageDataUrls)) {
        imageUrls.push(...requestBody.imageDataUrls);
    }

    for (const dataUrl of imageUrls) {
        // Parse data URL: data:image/png;base64,xxxxx
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
            parts.push({
                inline_data: {
                    mime_type: match[1],
                    data: match[2]  // Pure base64, no prefix
                }
            });
        }
    }

    // Get aspect ratio from size or settings
    const aspectRatio = getGeminiAspectRatio(settings.aspect_ratio || '1:1');

    const geminiRequestBody = {
        contents: [{ parts }],
        generationConfig: {
            responseModalities: ['IMAGE', 'TEXT'],  // Request both image and text
            imageConfig: {
                aspectRatio: aspectRatio
            }
        }
    };

    const headers = {
        'Content-Type': 'application/json',
    };
    if (getCurrentApiKey()) headers['Authorization'] = `Bearer ${getCurrentApiKey()}`;

    console.log(`[${extensionName}] Sending Gemini image request to ${endpoint}`);
    console.log(`[${extensionName}] Gemini request body:`, JSON.stringify(geminiRequestBody, null, 2));

    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(geminiRequestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${extensionName}] Gemini API Error:`, response.status, errorText);
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
            return {
                imageData: inlineData.data,
                mimeType: inlineData.mimeType || inlineData.mime_type || 'image/png'
            };
        }
    }

    // No image found in response
    console.error(`[${extensionName}] No image found in Gemini response parts:`, contentParts);
    throw new Error('No image returned from Gemini. The model may have returned text only.');
}

/**
 * Send image request using OpenRouter's chat completions format
 * OpenRouter uses /v1/chat/completions with modalities: ["image", "text"]
 */
async function sendOpenRouterImageRequest(settings, requestBody) {
    const endpoint = 'https://openrouter.ai/api/v1/chat/completions';

    // Build messages array with prompt and optional reference images
    const contentParts = [];

    // Add text prompt
    if (requestBody.prompt) {
        contentParts.push({ type: 'text', text: requestBody.prompt });
    }

    // Add reference images if provided
    const imageUrls = [];
    if (requestBody.imageDataUrl) {
        imageUrls.push(requestBody.imageDataUrl);
    }
    if (requestBody.imageDataUrls && Array.isArray(requestBody.imageDataUrls)) {
        imageUrls.push(...requestBody.imageDataUrls);
    }

    for (const dataUrl of imageUrls) {
        contentParts.push({
            type: 'image_url',
            image_url: { url: dataUrl }
        });
    }

    // Get aspect ratio
    const aspectRatio = getGeminiAspectRatio(settings.aspect_ratio || '1:1');

    const openRouterRequestBody = {
        model: requestBody.model,
        messages: [
            {
                role: 'user',
                content: contentParts.length === 1 ? requestBody.prompt : contentParts
            }
        ],
        modalities: ['image', 'text'],
        stream: false,
        image_config: {
            aspect_ratio: aspectRatio
        }
    };

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getCurrentApiKey()}`,
        'HTTP-Referer': window?.location?.origin || 'https://sillytavern.app',
        'X-Title': 'SillyTavern Pawtrait'
    };

    console.log(`[${extensionName}] Sending OpenRouter image request to ${endpoint}`);
    console.log(`[${extensionName}] OpenRouter request body:`, JSON.stringify(openRouterRequestBody, null, 2));

    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(openRouterRequestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${extensionName}] OpenRouter API Error:`, response.status, errorText);
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
                return {
                    imageData: match[2],
                    mimeType: match[1]
                };
            }
        }
    }

    // No image found in response
    console.error(`[${extensionName}] No image found in OpenRouter response:`, message);
    throw new Error('No image returned from OpenRouter. The model may have returned text only.');
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
    const dimensions = getPollinationsDimensions(settings.aspect_ratio || '1:1');

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

            if (response.ok) {
                const blob = await response.blob();
                const base64 = await getBase64Async(blob);
                const parts = base64.split(',');
                const mimeType = parts[0]?.match(/data:([^;]+)/)?.[1] || blob.type || 'image/png';
                const imageData = parts[1] || base64;

                console.log(`[${extensionName}] Pollinations image received: ${mimeType}, ${imageData.length} chars`);
                return { imageData, mimeType };
            }

            if (response.status >= 500 && attempt < maxRetries) {
                console.warn(`[${extensionName}] Pollinations server error ${response.status}, will retry...`);
                lastError = new Error(`Pollinations API Error ${response.status}`);
                continue;
            }

            const errorText = await response.text();
            throw new Error(`Pollinations API Error ${response.status}: ${errorText.substring(0, 200)}`);

        } catch (error) {
            lastError = error;
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

    // For LinkAPI with Gemini image models, use the Gemini native format
    if (providerConfig.id === 'linkapi' && isGeminiImageModel(requestBody.model)) {
        console.log(`[${extensionName}] Detected Gemini image model on LinkAPI, using native Gemini format`);
        return sendGeminiImageRequest(settings, requestBody);
    }

    // For OpenRouter, use chat completions with modalities
    if (providerConfig.id === 'openrouter') {
        console.log(`[${extensionName}] Using OpenRouter chat completions for image generation`);
        return sendOpenRouterImageRequest(settings, requestBody);
    }

    // For Pollinations, use URL-based API
    if (providerConfig.id === 'pollinations') {
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

    console.log(`[${extensionName}] Sending image request to ${endpoint}`);
    console.log(`[${extensionName}] Request body:`, JSON.stringify(finalRequestBody, null, 2));

    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(finalRequestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${extensionName}] Provider API Error:`, response.status, errorText);
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

    // Try to extract base64 image data from common response shapes
    const entry = result.data?.[0] || result.images?.[0] || (Array.isArray(result) ? result[0] : null) || null;

    // Common: { b64_json }
    if (entry?.b64_json) return { imageData: entry.b64_json, mimeType: 'image/png' };
    // Some providers return b64 field
    if (entry?.b64) return { imageData: entry.b64, mimeType: 'image/png' };
    // Some providers return url
    if (entry?.url) {
        const imgResponse = await fetch(entry.url);
        const blob = await imgResponse.blob();
        const base64 = await getBase64Async(blob);
        const parts = base64.split(',');
        return { imageData: parts[1] || base64, mimeType: blob.type || 'image/png' };
    }

    // Try alternative top-level fields
    if (result.b64_json) return { imageData: result.b64_json, mimeType: 'image/png' };
    if (result.b64) return { imageData: result.b64, mimeType: 'image/png' };

    // Nothing found
    console.error(`[${extensionName}] No image found in provider response:`, result);
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

    console.log(`[${extensionName}] Sending chat request to ${chatUrl}`);
    const response = await fetch(chatUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${extensionName}] Chat API Error:`, response.status, errorText);
        throw new Error(`Chat API Error ${response.status}: ${errorText}`);
    }

    return response.json();
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

    if (recentMessages.length === 0) {
        toastr.warning('No message found.', 'Pawtrait');
        return;
    }

    const btn = $('#nig_generate_btn');
    btn.addClass('generating').find('i').removeClass('fa-image').addClass('fa-spinner fa-spin');

    const lastMsg = recentMessages[recentMessages.length - 1];
    const sender = `${lastMsg.name}`;

    try {
        const result = await generateImageFromPrompt(lastMsg.text, sender, null);
        if (result) {
            $('#nig_preview_image').attr('src', `data:${result.mimeType};base64,${result.imageData}`);
            $('#nig_preview_container').show();
            addToGallery(result.imageData, lastMsg.text, null);
        }
    } catch (error) {
        console.error(`[${extensionName}] Error:`, error);
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

    try {
        const result = await generateImageFromPrompt(trimmedPrompt, null, null);
        if (result) {
            $('#nig_preview_image').attr('src', `data:${result.mimeType};base64,${result.imageData}`);
            $('#nig_preview_container').show();
            addToGallery(result.imageData, trimmedPrompt, null);
            return `data:${result.mimeType};base64,${result.imageData}`;
        }
    } catch (error) {
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
    console.log(`[${extensionName}] showEditGeneratePopup called with messageId:`, messageId);
    console.log(`[${extensionName}] Chat length:`, context.chat?.length);

    const message = context.chat[messageId];
    console.log(`[${extensionName}] Message at index ${messageId}:`, message?.mes?.substring(0, 100));

    if (!message?.mes) {
        toastr.warning('No message content found.', 'Pawtrait');
        return;
    }

    const settings = extension_settings[extensionName];
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
                            ${settings.gallery?.length > 0 ? `
                            <label class="nig_avatar_option">
                                <input type="checkbox" id="nig_include_prev" />
                                <img src="data:image/png;base64,${settings.gallery[0].imageData}" />
                                <span>Previous</span>
                            </label>
                            ` : ''}
                        </div>
                        ${!charAvatar && !userAvatar ? '<small class="nig_hint">No avatars available</small>' : ''}
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
            const summary = await summarizeWithAI(originalMessage, charName, userName);
            let newPrompt = settings.system_instruction ? settings.system_instruction + '\n\n' : '';
            newPrompt += summary;
            popup.find('#nig_edit_prompt').val(newPrompt);
            popup.find('#nig_edit_char_count').text(newPrompt.length);
            toastr.success('Prompt summarized!', 'Pawtrait');
        } catch (error) {
            console.error(`[${extensionName}] Summarize error:`, error);
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
            return;
        }

        btn.find('i').removeClass('fa-image').addClass('fa-spinner fa-spin');
        btn.css('pointer-events', 'none');

        try {
            // Build custom image data URLs based on selections
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

            // Generate with custom prompt and selected images
            const result = await generateImageWithOptions(promptText, imageDataUrls);

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
                    title: promptText.substring(0, 100),
                    source: MEDIA_SOURCE.GENERATED,
                    skipPrompt: true,
                });
                message.extra.media_index = message.extra.media.length - 1;
                message.extra.inline_image = true;

                appendMediaToMessage(message, messageElement, SCROLL_BEHAVIOR.KEEP);
                await saveChatConditional();
                addToGallery(result.imageData, promptText, messageId);

                popup.remove();
                toastr.success('Image generated!', 'Pawtrait');
            }
        } catch (error) {
            console.error(`[${extensionName}] Error:`, error);
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

    if (!getCurrentApiKey()) {
        throw new Error('API Key is not set.');
    }

    const requestBody = {
        model: settings.model,
        prompt: promptText,
        n: 1,
        size: getImageSize(settings.aspect_ratio),
        response_format: 'b64_json',
    };

    // Add images to request
    if (imageDataUrls.length === 1) {
        requestBody.imageDataUrl = imageDataUrls[0];
    } else if (imageDataUrls.length > 1) {
        requestBody.imageDataUrls = imageDataUrls;
    }

    console.log(`[${extensionName}] Calling provider image endpoint`);

    const result = await sendImageRequest(settings, requestBody);
    if (result?.imageData) {
        return { imageData: result.imageData, mimeType: result.mimeType || 'image/png' };
    }

    throw new Error('No image returned from API.');
}


jQuery(async () => {
    console.log(`[${extensionName}] Initializing...`);

    try {
        const response = await fetch(`/scripts/extensions/third-party/${extensionName}/settings.html`);
        if (!response.ok) throw new Error(`Failed to load template`);
        $('#extensions_settings').append(await response.text());
    } catch (error) {
        console.error(`[${extensionName}] Error:`, error);
        toastr.error('Failed to load settings.', 'Pawtrait');
        return;
    }

    await loadSettings();

    // Delayed refresh of character dropdown to ensure characters are loaded
    setTimeout(populateCharacterDropdown, 1000);

    // Tab Navigation
    $('.nig_tab').on('click', function() {
        const tab = $(this).data('tab');
        $('.nig_tab').removeClass('active');
        $(this).addClass('active');
        $('.nig_tab_content').removeClass('active');
        $(`.nig_tab_content[data-tab="${tab}"]`).addClass('active');
    });

    // API Settings
    $('#nig_api_endpoint').on('input', function() {
        extension_settings[extensionName].api_endpoint = String($(this).val()).trim();
        saveSettingsDebounced();
    });

    $('#nig_api_key').on('input', function() {
        const key = String($(this).val()).trim();
        setCurrentApiKey(key);
        saveSettingsDebounced();
    });

    // Provider selection
    $('#nig_provider').on('change', async function() {
        const v = $(this).val();
        extension_settings[extensionName].provider = v;

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
        }
        // For 'custom', keep whatever the user has entered

        // Update API key field to show the key for the new provider
        $('#nig_api_key').val(getCurrentApiKey());

        // Clear model dropdown and fetch models for new provider
        $('#nig_model').empty().append('<option value="">-- Click Fetch Models --</option>');

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
        extension_settings[extensionName].model = $(this).val();
        updateModelInfo();
        saveSettingsDebounced();
    });

    $('#nig_summarizer_model').on('change', function() {
        extension_settings[extensionName].summarizer_model = $(this).val();
        saveSettingsDebounced();
    });

    $('#nig_auto_summarize').on('change', function() {
        extension_settings[extensionName].auto_summarize = $(this).prop('checked');
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
        updateSavedCharactersList();
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
        extension_settings[extensionName].aspect_ratio = $(this).val();
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
        updateSavedCharactersList();
    });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => setTimeout(injectAllMessageButtons, 100));
    eventSource.on(event_types.CHAT_CREATED, () => setTimeout(injectAllMessageButtons, 100));
    eventSource.on(event_types.CHARACTER_PAGE_LOADED, () => {
        setTimeout(populateCharacterDropdown, 200);
    });
    eventSource.on(event_types.APP_READY, () => {
        setTimeout(populateCharacterDropdown, 500);
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
});
