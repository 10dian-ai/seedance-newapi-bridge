import * as p from './seedance-bridge.js';

let checks = 0;
function ok(value, name) {
  checks += 1;
  if (!value) throw new Error('FAIL ' + name);
  console.log('PASS ' + name);
}
function throws(fn, pattern, name) {
  let error = null;
  try { fn(); } catch (e) { error = e; }
  ok(error && (!pattern || pattern.test(String(error.message))), name);
}

const baseCtx = { baseUrl: 'https://up.example', apiKey: 'sk-upstream', upstream: { kind: 'new_api' }, model: 'doubao-seedance-2-5-260628', upstreamModel: 'doubao-seedance-2-5-260628' };

// Official native request: text-to-video.
let decoded = p.native.createTask({ body: { kind: 'json', value: {
  model: 'doubao-seedance-2-5-260628',
  content: [{ type: 'text', text: 'a cat dances' }],
  duration: 5,
  resolution: '720p',
  ratio: '16:9',
} } });
ok(decoded.kind === 'submit' && decoded.action === 'text_to_video', 'native official t2v decode');
let submit = p.buildSubmitRequest({ ...baseCtx, requestBody: decoded.requestBody });
ok(submit.url === 'https://up.example/doubao/api/v3/contents/generations/tasks', 'new_api upstream native route');
ok(submit.body.model === 'doubao-seedance-2-5-260628' && submit.body.duration === 5 && submit.body.resolution === '720p', 'upstream official body');
ok(submit.body.content.length === 1 && submit.body.content[0].type === 'text', 'upstream content text');

// Official native image + video references, and defensive limits.
decoded = p.native.createTask({ body: { kind: 'json', value: {
  model: 'jimeng-seedance-2.5',
  content: [
    { type: 'image_url', image_url: { url: 'https://cdn.example/a.png' } },
    { type: 'video_url', video_url: { url: 'https://cdn.example/ref.mp4' } },
    { type: 'text', text: 'continue the motion' },
  ],
  duration: 10,
  resolution: '1080p',
} } });
ok(decoded.action === 'image_to_video' && decoded.requestBody.images.length === 1 && decoded.requestBody.videos.length === 1, 'native reference media decode');
submit = p.buildSubmitRequest({ ...baseCtx, requestBody: decoded.requestBody, upstreamModel: 'jimeng-seedance-2.5' });
ok(submit.body.model === 'doubao-seedance-2-5-260628' && submit.body.content.length === 3, 'model alias mapped upstream');
ok(submit.body.content[0].type === 'image_url' && submit.body.content[1].type === 'video_url', 'media order preserved');

// Upstream response/task lifecycle.
let parsed = p.parseSubmitResponse({ ...baseCtx, requestBody: decoded.requestBody }, { statusCode: 202, body: { id: 'task-public-1', status: 'queued' } });
ok(parsed.taskId === 'task-public-1' && parsed.state.duration === 10, 'accept async 202 and persist state');
let query = p.buildQueryRequest({ ...baseCtx, taskId: parsed.taskId, state: parsed.state });
ok(query.url.endsWith('/doubao/api/v3/contents/generations/tasks/task-public-1') && query.method === 'GET', 'query upstream task');
let result = p.parseTaskResult({}, { status: 'processing' });
ok(result.status === 'IN_PROGRESS', 'processing maps to running');
result = p.parseTaskResult({}, { status: 'succeeded', content: { video_url: 'https://cdn.example/out.mp4', resolution: '1080p' }, usage: { completion_tokens: 123 } });
ok(result.status === 'SUCCESS' && result.url.endsWith('out.mp4') && result.completionTokens === 123, 'success URL and usage parse');
result = p.parseTaskResult({}, { status: 'failed', error: { code: 'quota', message: 'quota exhausted' } });
ok(result.status === 'FAILURE' && /quota exhausted/.test(result.reason), 'failure parse');

// Official native renderers.
let created = p.native.taskCreated({}, { task_id: 'task-public-1', data: { status: 'queued' } });
ok(created.id === 'task-public-1' && created.status === 'queued', 'native taskCreated render');
let status = p.native.taskStatus({}, { task_id: 'task-public-1', data: { status: 'succeeded', content: { video_url: 'https://cdn/out.mp4' } } });
ok(status.id === 'task-public-1' && status.content.video_url.endsWith('out.mp4'), 'native taskStatus render');

// Artifact and content handling.
const task = { status: 'SUCCESS', data: { status: 'succeeded', content: { video_url: 'https://cdn/out.mp4', last_frame_url: 'https://cdn/last.png' } } };
ok(p.listArtifacts(task).length === 2, 'video and last-frame artifacts');
let content = p.buildContentRequest({ artifactKey: 'video', data: task.data, clientRequest: { method: 'GET' } });
ok(content.url.endsWith('out.mp4') && content.credentialless === true, 'credentialless video content');

// Billing and validation.
let usage = p.extractUsage({ ...baseCtx, requestBody: decoded.requestBody });
ok(usage.resolution === '1080p' && usage.video_input === 'video' && usage.tokens > 0, 'usage facts');
usage = p.extractUsageOnComplete({ state: { resolution: '1080p' } }, {}, { status: 'succeeded', resolution: '1080p', usage: { total_tokens: 456 } });
ok(usage.tokens === 456 && usage.resolution === '1080p', 'completion usage settlement');
throws(() => p.native.createTask({ body: { kind: 'json', value: { model: 'doubao-seedance-2-5-260628', content: [{ type: 'text', text: 'x' }], resolution: '4k' } } }), /not supported/, 'reject unsupported 4k');
throws(() => p.native.createTask({ body: { kind: 'json', value: { model: 'doubao-seedance-2-5-260628', content: [{ type: 'text', text: 'x' }], duration: 0 } } }), /between/, 'reject invalid duration');
throws(() => p.native.createTask({ body: { kind: 'json', value: { model: 'doubao-seedance-2-5-260628', content: [{ type: 'text', text: 'x' }], ratio: '2:1' } } }), /ratio must/, 'reject invalid ratio');
throws(() => p.native.createTask({ body: { kind: 'json', value: { model: 'doubao-seedance-2-5-260628', content: [{ type: 'video_url', video_url: { url: 'ftp://bad' } }] } } }), /http/, 'reject invalid media URL');
throws(() => p.native.createTask({ body: { kind: 'json', value: { model: 'doubao-seedance-2-5-260628', content: [{ type: 'text', text: 'x' }], generate_audio: 'yes' } } }), /boolean/, 'reject invalid boolean');

console.log(`---- ${checks} checks passed`);

// Vendor-style fallback removes the New API plugin prefix.
const vendorSubmit = p.buildSubmitRequest({ ...baseCtx, upstream: { kind: 'vendor' }, requestBody: decoded.requestBody });
ok(vendorSubmit.url === 'https://up.example/api/v3/contents/generations/tasks', 'vendor upstream route');

// Official non-success response is converted to a deterministic plugin error.
throws(() => p.parseSubmitResponse({ ...baseCtx, requestBody: decoded.requestBody }, { statusCode: 200, body: { code: 10001, message: 'bad request' } }), /bad request/, 'official business error');

console.log(`---- ${checks} checks passed total`);
