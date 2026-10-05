// Seedance Bridge for New API Task Plugin API v1.
//
// Client side: official Volcengine Doubao/Seedance wire format.
// Upstream side: another New API with the official Doubao plugin, or a
// compatible vendor endpoint. The client never sees the upstream protocol.
//
// Native client routes:
//   POST /doubao/api/v3/contents/generations/tasks
//   GET  /doubao/api/v3/contents/generations/tasks/:task_id
//
// This bridge intentionally keeps the public route compatible with the
// official plugin. Do not install it together with another plugin claiming the
// same /doubao routes on one New API instance.

const MODEL_ALIASES = {
  "doubao-seedance-2-5-260628": "doubao-seedance-2-5-260628",
  "jimeng-seedance-2.5": "doubao-seedance-2-5-260628",
  "seedance-2.5": "doubao-seedance-2-5-260628",
};

const MODEL_PROFILES = {
  "doubao-seedance-2-5-260628": {
    resolutions: ["480p", "720p", "1080p"],
    videoInput: true,
    audio: false,
    minSeconds: 1,
    maxSeconds: 3600,
  },
};

const RESOLUTIONS = ["480p", "720p", "1080p", "4k"];
const SEEDANCE_25_RESOLUTIONS = ["480p", "720p", "1080p"];
const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"];
const MAX_CONTENT_ITEMS = 32;
const MAX_REFERENCE_IMAGES = 14;
const MAX_REFERENCE_VIDEOS = 1;
const MAX_PROMPT_LENGTH = 20000;
const MAX_METADATA_KEYS = 64;
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const SAFE_FORWARD_FIELDS = [
  "ratio",
  "resolution",
  "seed",
  "generate_audio",
  "camera_fixed",
  "watermark",
  "return_last_frame",
  "service_tier",
];

const UNIT_LABEL = { en: "token", zh: "Token" };

function trimmed(value) {
  return String(value == null ? "" : value).trim();
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function canonicalModel(value) {
  const name = trimmed(value);
  if (!name) return "";
  return MODEL_ALIASES[name] || name;
}

function profileFor(value) {
  const model = canonicalModel(value);
  return MODEL_PROFILES[model] || null;
}

function modelForContext(ctx, request) {
  const candidates = [ctx && ctx.upstreamModel, ctx && ctx.model, request && request.model];
  for (const candidate of candidates) {
    const model = canonicalModel(candidate);
    if (model) return model;
  }
  throw new Error("model is required");
}

function validateMetadata(value) {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new Error("metadata must be an object");
  const keys = Object.keys(value);
  if (keys.length > MAX_METADATA_KEYS) throw new Error("metadata has too many fields");
  return value;
}

function validatePrompt(value, required) {
  const prompt = trimmed(value);
  if (prompt.length > MAX_PROMPT_LENGTH) throw new Error("prompt is too long");
  if (required && !prompt) throw new Error("content is required");
  return prompt;
}

function normalizeRatio(value) {
  const ratio = trimmed(value).toLowerCase();
  if (!ratio) return "";
  if (!RATIOS.includes(ratio)) throw new Error("ratio must be one of " + RATIOS.join(", "));
  return ratio;
}

function normalizeResolution(value, profile) {
  const raw = trimmed(value).toLowerCase().replace(/\*/g, "x");
  if (!raw) return "";
  let resolution = raw;
  if (!RESOLUTIONS.includes(raw)) {
    const parts = raw.split("x");
    if (parts.length !== 2) throw new Error("resolution must be one of " + RESOLUTIONS.join(", "));
    const width = Number(parts[0]);
    const height = Number(parts[1]);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error("resolution must be a tier or WxH size");
    }
    const max = Math.max(width, height);
    if (max >= 3840) resolution = "4k";
    else if (max >= 1920) resolution = "1080p";
    else if (max >= 1280) resolution = "720p";
    else resolution = "480p";
  }
  if (profile && !profile.resolutions.includes(resolution)) {
    throw new Error("resolution " + resolution + " is not supported by the selected model");
  }
  return resolution;
}

function normalizeDuration(value, profile, fallback) {
  if (value === undefined || value === null || value === "") return fallback == null ? 5 : fallback;
  const seconds = finiteNumber(value);
  if (seconds === null || !Number.isInteger(seconds)) throw new Error("duration must be an integer number of seconds");
  const min = profile ? profile.minSeconds : 1;
  const max = profile ? profile.maxSeconds : 3600;
  if (seconds < min || seconds > max) throw new Error("duration must be between " + min + " and " + max + " seconds");
  return seconds;
}

function normalizeBoolean(value, name) {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(name + " must be a boolean");
}

function normalizeSeed(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const seed = finiteNumber(value);
  if (seed === null || !Number.isInteger(seed) || seed < -1 || seed > 4294967295) {
    throw new Error("seed must be an integer between -1 and 4294967295");
  }
  return seed;
}

function urlFromValue(value) {
  if (typeof value === "string") return trimmed(value);
  if (!isObject(value)) return "";
  if (typeof value.url === "string") return trimmed(value.url);
  if (typeof value.image_url === "string") return trimmed(value.image_url);
  if (isObject(value.image_url) && typeof value.image_url.url === "string") return trimmed(value.image_url.url);
  if (typeof value.video_url === "string") return trimmed(value.video_url);
  if (isObject(value.video_url) && typeof value.video_url.url === "string") return trimmed(value.video_url.url);
  return "";
}

function fileRef(value) {
  if (!isObject(value) || !value.__fileRef) return null;
  const result = {
    __fileRef: String(value.__fileRef),
    encoding: value.encoding || "dataUrl",
    maxBytes: Number(value.maxBytes || MAX_FILE_BYTES),
  };
  if (value.mimeType) result.mimeType = trimmed(value.mimeType);
  return result;
}

function mediaItem(value, type) {
  const ref = fileRef(value);
  if (ref) return ref;
  const url = urlFromValue(value);
  if (!url) throw new Error(type + " reference must contain a URL");
  if (!/^https?:\/\//i.test(url) && !/^data:/i.test(url)) {
    throw new Error(type + " reference must be an http(s) URL or data URL");
  }
  return url;
}

function collectContent(content, images, videos, texts) {
  if (content === undefined || content === null) return;
  if (!Array.isArray(content)) throw new Error("content must be an array");
  for (const item of content) {
    if (!isObject(item)) throw new Error("content item must be an object");
    const type = trimmed(item.type);
    if (type === "text" || type === "input_text") {
      if (typeof item.text === "string") texts.push(item.text);
      continue;
    }
    if (type === "image_url" || type === "input_image" || type === "image") {
      images.push(mediaItem(item.image_url || item.image || item.url, "image"));
      continue;
    }
    if (type === "video_url" || type === "input_video" || type === "video") {
      videos.push(mediaItem(item.video_url || item.video || item.url, "video"));
      continue;
    }
    if (type === "draft_task") {
      // Draft tasks are accepted and preserved for upstream New API plugins.
      continue;
    }
    throw new Error("unsupported content type: " + type);
  }
}

function pushUnique(list, value) {
  const key = typeof value === "string" ? value : JSON.stringify(value);
  if (!list.some((item) => (typeof item === "string" ? item : JSON.stringify(item)) === key)) list.push(value);
}

function mediaFromArray(value, type, target) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) throw new Error(type + " must be an array");
  for (const item of value) pushUnique(target, mediaItem(item, type));
}

function contentRequest(body, ctx) {
  const input = body || {};
  const metadata = validateMetadata(input.metadata);
  const model = canonicalModel((ctx && ctx.model) || input.model);
  const profile = profileFor(model) || profileFor(ctx && ctx.upstreamModel) || MODEL_PROFILES["doubao-seedance-2-5-260628"];
  const images = [];
  const videos = [];
  const texts = [];

  collectContent(input.content, images, videos, texts);
  collectContent(metadata.content, images, videos, texts);
  for (const key of ["image", "input_reference"]) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== "") pushUnique(images, mediaItem(input[key], "image"));
  }
  mediaFromArray(input.images, "image", images);
  mediaFromArray(input.image_urls, "image", images);
  mediaFromArray(input.reference_images, "image", images);
  mediaFromArray(input.videos, "video", videos);
  mediaFromArray(input.video_urls, "video", videos);
  mediaFromArray(input.reference_videos, "video", videos);
  mediaFromArray(metadata.image_urls, "image", images);
  mediaFromArray(metadata.video_urls, "video", videos);

  const prompt = validatePrompt(input.prompt || texts.join("\n"), images.length + videos.length === 0);
  if (images.length > MAX_REFERENCE_IMAGES) throw new Error("at most " + MAX_REFERENCE_IMAGES + " reference images are supported");
  if (videos.length > MAX_REFERENCE_VIDEOS) throw new Error("at most " + MAX_REFERENCE_VIDEOS + " reference video is supported");
  if (images.length + videos.length > MAX_CONTENT_ITEMS) throw new Error("too many content items");
  if (videos.length && !profile.videoInput) throw new Error("the selected model does not support reference video");

  const resolution = normalizeResolution(input.resolution || metadata.resolution || input.size || metadata.size, profile);
  const ratio = normalizeRatio(input.ratio || input.aspect_ratio || metadata.ratio || metadata.aspect_ratio);
  const duration = normalizeDuration(
    input.duration !== undefined ? input.duration : input.seconds !== undefined ? input.seconds : metadata.duration,
    profile,
    5
  );
  const seed = normalizeSeed(input.seed !== undefined ? input.seed : metadata.seed);
  const generateAudio = normalizeBoolean(
    input.generate_audio !== undefined ? input.generate_audio : metadata.generate_audio,
    "generate_audio"
  );

  const cleanMetadata = {};
  for (const key of SAFE_FORWARD_FIELDS) {
    if (hasOwn(metadata, key)) cleanMetadata[key] = metadata[key];
  }
  if (Array.isArray(metadata.content)) cleanMetadata.content = metadata.content;
  if (hasOwn(metadata, "draft_task")) cleanMetadata.draft_task = metadata.draft_task;

  return {
    model: model || "doubao-seedance-2-5-260628",
    prompt,
    images,
    videos,
    duration,
    resolution: resolution || "720p",
    ratio,
    seed,
    generateAudio,
    metadata: cleanMetadata,
    originalModel: trimmed(input.model || (ctx && ctx.model)),
  };
}

function contentEntry(type, value) {
  if (isObject(value) && value.__fileRef) {
    return type === "image" ? { type: "image_url", image_url: { url: value } } : { type: "video_url", video_url: { url: value } };
  }
  return type === "image" ? { type: "image_url", image_url: { url: value } } : { type: "video_url", video_url: { url: value } };
}

function requestContent(request) {
  const content = [];
  for (const image of request.images) content.push(contentEntry("image", image));
  for (const video of request.videos) content.push(contentEntry("video", video));
  if (request.prompt) content.push({ type: "text", text: request.prompt });
  return content;
}

function officialBody(request, model) {
  const body = {
    model: canonicalModel(model || request.model),
    content: requestContent(request),
    duration: request.duration,
    resolution: request.resolution,
  };
  if (request.ratio) body.ratio = request.ratio;
  if (request.seed !== undefined) body.seed = request.seed;
  if (request.generateAudio !== undefined) body.generate_audio = request.generateAudio;
  for (const key of SAFE_FORWARD_FIELDS) {
    if (request.metadata && hasOwn(request.metadata, key) && body[key] === undefined) body[key] = request.metadata[key];
  }
  if (request.metadata && request.metadata.draft_task !== undefined) body.draft_task = request.metadata.draft_task;
  return body;
}

function apiRoot(ctx) {
  const base = trimmed(ctx && ctx.baseUrl).replace(/\/+$/, "");
  if (!base) throw new Error("channel API address is required");
  return base + (ctx && ctx.upstream && ctx.upstream.kind === "new_api" ? "/doubao" : "");
}

function isNewApiUpstream(ctx) {
  return !!(ctx && ctx.upstream && ctx.upstream.kind === "new_api");
}

function errorMessage(body) {
  if (!body || typeof body !== "object") return "";
  if (typeof body.message === "string" && body.message.trim()) return body.message.trim();
  if (typeof body.error === "string" && body.error.trim()) return body.error.trim();
  if (isObject(body.error)) return trimmed(body.error.message || body.error.code);
  if (isObject(body.data) && typeof body.data.message === "string") return body.data.message.trim();
  return "";
}

function taskIdFrom(body, headers) {
  if (body && typeof body === "object") {
    const data = isObject(body.data) ? body.data : {};
    const id = trimmed(body.id || body.task_id || body.taskId || data.id || data.task_id || data.taskId);
    if (id) return id;
  }
  if (headers && typeof headers === "object") {
    const location = headers.location || headers.Location;
    if (location) return trimmed(String(location).split("/").pop());
  }
  return "";
}

function taskData(body, request, ctx) {
  const result = isObject(body) ? Object.assign({}, body) : {};
  result.bridge = {
    client_model: request.originalModel || request.model,
    upstream_model: canonicalModel((ctx && ctx.upstreamModel) || request.model),
    duration: request.duration,
    resolution: request.resolution,
    ratio: request.ratio,
  };
  return result;
}

function statusValue(body) {
  if (!body || typeof body !== "object") return "";
  const data = isObject(body.data) ? body.data : {};
  return trimmed(body.status || data.status || body.state || data.state).toLowerCase();
}

function resultVideoURL(body) {
  if (!body || typeof body !== "object") return "";
  const data = isObject(body.data) ? body.data : {};
  const content = isObject(body.content) ? body.content : isObject(data.content) ? data.content : {};
  return trimmed(
    body.video_url || data.video_url || content.video_url || body.url || data.url || content.url ||
    body.output_url || data.output_url
  );
}

function resultResolution(body) {
  if (!body || typeof body !== "object") return "";
  const data = isObject(body.data) ? body.data : {};
  const content = isObject(body.content) ? body.content : isObject(data.content) ? data.content : {};
  return trimmed(body.resolution || data.resolution || content.resolution).toLowerCase();
}

function statusMap(status) {
  const value = trimmed(status).toLowerCase();
  if (["queued", "pending", "created", "submitted", "in_queue", "not_start"].includes(value)) return "QUEUED";
  if (["running", "processing", "in_progress", "generating"].includes(value)) return "IN_PROGRESS";
  if (["succeeded", "success", "completed", "done"].includes(value)) return "SUCCESS";
  if (["failed", "failure", "expired", "cancelled", "canceled"].includes(value)) return "FAILURE";
  return "UNKNOWN";
}

function errorObject(body) {
  const message = errorMessage(body);
  if (!message) return null;
  const data = isObject(body && body.data) ? body.data : {};
  return {
    code: trimmed((body && body.code) || data.code || (body && body.error && body.error.code)) || "upstream_error",
    message,
  };
}

function resolutionMaxPixels(resolution) {
  if (resolution === "480p") return [854, 480];
  if (resolution === "1080p") return [1920, 1080];
  if (resolution === "4k") return [3840, 2160];
  return [1280, 720];
}

function estimateTokens(seconds, resolution) {
  const dims = resolutionMaxPixels(resolution);
  return (seconds * dims[0] * dims[1] * 24) / 1024;
}

function requestHasVideo(request) {
  return !!(request && Array.isArray(request.videos) && request.videos.length);
}

function usageRequest(ctx) {
  const req = ctx && ctx.requestBody;
  if (req && req.model) return req;
  return {};
}

function canonicalUsage(ctx) {
  const req = usageRequest(ctx);
  const request = contentRequest(req, { model: ctx && (ctx.model || ctx.upstreamModel) });
  return request;
}

export const meta = {
  apiVersion: 1,
  key: "seedance-bridge",
  name: "Seedance Bridge",
  description: {
    en: "Official Seedance API bridge to an upstream New API",
    zh: "Seedance 官方协议到上游 New API 的桥接插件",
  },
  version: "1.0.0",
  author: { name: "Custom" },
  models: Object.keys(MODEL_ALIASES),
  fetchMode: "per_task",
  upstreams: ["vendor", "new_api"],
  usageSchema: {
    tokens: { type: "number", unit: UNIT_LABEL.en, description: { en: "Billing token unit price", zh: "计费 Token 单价" } },
    resolution: {
      enum: SEEDANCE_25_RESOLUTIONS,
      enumLabels: Object.fromEntries(SEEDANCE_25_RESOLUTIONS.map((value) => [value, { en: value, zh: value }])),
      description: { en: "Output video resolution", zh: "输出视频分辨率" },
    },
    video_input: {
      enum: ["none", "video"],
      enumLabels: { none: { en: "No reference video", zh: "无参考视频" }, video: { en: "Reference video", zh: "有参考视频" } },
      description: { en: "Reference video input", zh: "参考视频输入" },
    },
  },
  usageExamples: [
    { label: "720p · 5s", facts: { tokens: estimateTokens(5, "720p"), resolution: "720p", video_input: "none" } },
    { label: "1080p · 5s", facts: { tokens: estimateTokens(5, "1080p"), resolution: "1080p", video_input: "none" } },
    { label: "720p · 5s · 参考视频", facts: { tokens: estimateTokens(5, "720p"), resolution: "720p", video_input: "video" } },
  ],
  routes: [
    { method: "POST", path: "/doubao/api/v3/contents/generations/tasks", type: "submit", decode: "createTask", render: "taskCreated" },
    { method: "GET", path: "/doubao/api/v3/contents/generations/tasks/:task_id", type: "query", render: "taskStatus" },
  ],
};

export const native = {
  createTask(ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const body = ctx.body.value;
    if (!isObject(body)) throw new Error("request body must be an object");
    const model = canonicalModel(body.model);
    if (!model) throw new Error("model is required");
    if (body.content !== undefined && !Array.isArray(body.content)) throw new Error("content must be an array");
    const request = contentRequest(body, { model });
    if (!request.prompt && !request.images.length && !request.videos.length) throw new Error("content is required");
    return {
      kind: "submit",
      model,
      action: request.videos.length || request.images.length ? "image_to_video" : "text_to_video",
      requestBody: request,
    };
  },
  taskCreated(ctx, task) {
    const data = isObject(task && task.data) ? task.data : {};
    return Object.assign({}, data, { id: task.task_id });
  },
  taskStatus(ctx, task) {
    const data = isObject(task && task.data) ? task.data : {};
    if (Object.keys(data).length) return Object.assign({}, data, { id: task.task_id });
    const map = { NOT_START: "queued", SUBMITTED: "queued", QUEUED: "queued", IN_PROGRESS: "running", SUCCESS: "succeeded", FAILURE: "failed" };
    const output = { id: task.task_id, status: map[task.status] || "queued" };
    if (task.fail_reason) output.error = { message: task.fail_reason };
    return output;
  },
  error(ctx, error) {
    return { error: { code: error.code || "plugin_error", message: error.message } };
  },
};

export function buildSubmitRequest(ctx) {
  const request = ctx.requestBody && ctx.requestBody.model && ctx.requestBody.images !== undefined
    ? ctx.requestBody
    : contentRequest(ctx.requestBody || {}, ctx);
  const mappedModel = canonicalModel(ctx.upstreamModel || request.model);
  const body = officialBody(request, mappedModel);
  const root = apiRoot(ctx);
  const url = root + "/api/v3/contents/generations/tasks";
  return {
    url,
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + trimmed(ctx.apiKey) },
    body,
    action: request.images.length || request.videos.length ? "image_to_video" : "text_to_video",
    rewriteModel: mappedModel,
  };
}

export function parseSubmitResponse(ctx, resp) {
  const body = resp && resp.body;
  const statusCode = Number(resp && resp.statusCode || 0);
  const error = errorObject(body);
  if (statusCode >= 400) throw new Error(error ? error.message : "upstream returned status " + statusCode);
  if (error && !taskIdFrom(body, resp && resp.headers)) throw new Error(error.message);
  const taskId = taskIdFrom(body, resp && resp.headers);
  if (!taskId) throw new Error("task_id is empty");
  const request = ctx.requestBody && ctx.requestBody.model && ctx.requestBody.images !== undefined
    ? ctx.requestBody
    : contentRequest(ctx.requestBody || {}, ctx);
  const state = {
    client_model: request.originalModel || request.model,
    upstream_model: canonicalModel(ctx.upstreamModel || request.model),
    duration: request.duration,
    resolution: request.resolution,
    ratio: request.ratio,
    video_input: request.videos.length ? "video" : "none",
  };
  return { taskId, taskData: taskData(body, request, ctx), state };
}

export function buildQueryRequest(ctx) {
  const root = apiRoot(ctx);
  return {
    url: root + "/api/v3/contents/generations/tasks/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + trimmed(ctx.apiKey) },
  };
}

export function parseTaskResult(ctx, body) {
  const error = errorObject(body);
  const mapped = statusMap(statusValue(body));
  if (error && mapped === "UNKNOWN") return { status: "FAILURE", progress: "100%", reason: error.message };
  if (mapped === "QUEUED") return { status: "QUEUED", progress: "10%" };
  if (mapped === "IN_PROGRESS") return { status: "IN_PROGRESS", progress: "50%" };
  if (mapped === "SUCCESS") {
    const output = { status: "SUCCESS", progress: "100%" };
    const url = resultVideoURL(body);
    if (url) {
      output.url = url;
      output.remoteUrl = url;
    }
    const resolution = resultResolution(body);
    if (resolution) output.resolution = resolution;
    const data = isObject(body && body.data) ? body.data : {};
    const content = isObject(body && body.content) ? body.content : isObject(data.content) ? data.content : {};
    const usage = isObject(body && body.usage) ? body.usage : isObject(data.usage) ? data.usage : {};
    const tokens = finiteNumber(usage.completion_tokens || usage.total_tokens || content.completion_tokens);
    if (tokens !== null && tokens > 0) output.completionTokens = tokens;
    return output;
  }
  if (mapped === "FAILURE") return { status: "FAILURE", progress: "100%", reason: error ? error.message : statusValue(body) || "task failed" };
  return { status: "UNKNOWN", reason: "unrecognized status: " + statusValue(body) };
}

function artifactData(task) {
  const data = isObject(task && task.data) ? task.data : {};
  if (isObject(data.data) && data.data.task_id && hasOwn(data.data, "data")) return data.data.data || {};
  return data;
}

function artifactURL(task, key) {
  const data = artifactData(task);
  const nested = isObject(data.content) ? data.content : isObject(data.data) && isObject(data.data.content) ? data.data.content : {};
  if (key === "video") return trimmed(nested.video_url || data.video_url || data.url);
  if (key === "last_frame") return trimmed(nested.last_frame_url || data.last_frame_url);
  return "";
}

export function listArtifacts(task) {
  if (!task || task.status !== "SUCCESS") return [];
  const result = [];
  if (artifactURL(task, "video")) result.push({ key: "video", type: "video", mimeType: "video/mp4" });
  if (artifactURL(task, "last_frame")) result.push({ key: "last_frame", type: "image", mimeType: "image/png" });
  return result;
}

export function buildContentRequest(ctx) {
  if (!["video", "last_frame"].includes(ctx.artifactKey)) throw new Error("artifact_not_found");
  const url = artifactURL(ctx, ctx.artifactKey);
  if (!url) throw new Error("artifact_not_found");
  return { url, method: trimmed(ctx.clientRequest && ctx.clientRequest.method) || "GET", credentialless: true };
}

export function extractUsage(ctx) {
  if (ctx && ctx.usagePurpose === "billing_ratios") return null;
  const request = canonicalUsage(ctx);
  return {
    tokens: estimateTokens(request.duration, request.resolution),
    resolution: request.resolution,
    video_input: request.videos.length ? "video" : "none",
  };
}

export function extractUsageOnComplete(task, taskResult, body) {
  if (statusMap(statusValue(body)) !== "SUCCESS") return {};
  const state = (task && task.state) || (task && task.data && task.data.bridge) || {};
  const resolution = resultResolution(body) || trimmed(state.resolution);
  const data = isObject(body && body.data) ? body.data : {};
  const content = isObject(body && body.content) ? body.content : isObject(data.content) ? data.content : {};
  const usage = isObject(body && body.usage) ? body.usage : isObject(data.usage) ? data.usage : {};
  const tokens = finiteNumber(usage.completion_tokens || usage.total_tokens || content.completion_tokens);
  const output = {};
  if (tokens !== null && tokens > 0) output.tokens = tokens;
  if (RESOLUTIONS.includes(resolution)) output.resolution = resolution;
  return output;
}

export const protocols = {};
