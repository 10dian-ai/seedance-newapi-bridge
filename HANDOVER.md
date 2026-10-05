# Seedance Bridge — New API Task Plugin

`seedance-bridge.js` is a New API Task Plugin API v1 bridge for this deployment shape:

```text
Client using the official Seedance/Doubao API
  -> your New API (this plugin)
  -> upstream New API (/doubao plugin)
  -> Seedance official service
```

The bridge is installed on the client-facing New API. It exposes the official
native task routes and converts the request to the upstream New API's native
Doubao route. It does not call Seedance directly.

## Public routes

```text
POST /doubao/api/v3/contents/generations/tasks
GET  /doubao/api/v3/contents/generations/tasks/:task_id
```

The request and response surface follows the official Doubao/Seedance task
format: `model`, `content`, `duration`, `resolution`, `ratio`, `seed`,
`generate_audio`, and the official `id/status/content/error` response shapes.

## Upstream behavior

When the channel is a type-60 New API upstream, the driver calls:

```text
POST {base}/doubao/api/v3/contents/generations/tasks
GET  {base}/doubao/api/v3/contents/generations/tasks/{id}
```

The channel API key is sent as `Authorization: Bearer <key>`.

For a vendor-style upstream, the `/doubao` prefix is omitted and the same
official `/api/v3/...` paths are used. The bridge accepts 2xx task creation
responses and task IDs in `id`, `task_id`, nested `data`, or `Location` headers.

## Supported model names

The canonical official model is:

```text
doubao-seedance-2-5-260628
```

These compatibility aliases are accepted and normalized before the upstream
request:

```text
jimeng-seedance-2.5
seedance-2.5
```

The model profile currently permits 480p, 720p, and 1080p, reference video,
and 1–3600 second integer durations. Unsupported 4K requests are rejected
before quota reservation.

## Defensive behavior

- Requires a JSON object and a model.
- Validates content item types and URL schemes.
- Deduplicates media references while retaining order.
- Limits prompt length, metadata size, content count, image count, and video count.
- Validates duration, resolution, ratio, seed, and booleans.
- Keeps only an allowlist of safe metadata fields for forwarding.
- Preserves bridge state across polling so model, duration, resolution, and
  video-input billing facts do not disappear when upstream task data changes.
- Accepts queued/running/succeeded/failed aliases and returns deterministic
  internal task states.
- Reads video URLs from common nested response shapes and exposes video and
  last-frame artifacts as credentialless URLs.

## Billing

The usage facts are:

```text
tokens       estimated from duration and resolution
resolution   480p / 720p / 1080p
video_input  none / video
```

For Seedance 2.5, an administrator should configure the corresponding
Expression prices in System Settings → Billing → Model Pricing. Completion
usage replaces the estimate when the upstream returns token usage.

## Installation

1. Upload `seedance-bridge.js` under Task Plugins.
2. Do not install another plugin claiming `/doubao/api/v3/contents/generations/tasks`
   on the same client-facing New API; routes would conflict.
3. Create a task-plugin channel using the bridge and point its Base URL to the
   upstream New API. Use the upstream gateway token as the channel key.
4. On the upstream New API, install/enable the official Doubao/Seedance plugin
   and verify its native route works independently.
5. Configure model mapping if the upstream uses a different model name.
6. Test a 720p text-to-video request before enabling customer traffic.

## Validation

Run the pure-function contract tests with:

```bash
node test-seedance-bridge.mjs
```

The test suite covers official request decoding, upstream New API routing,
model alias mapping, image/video content, asynchronous 202 responses,
querying, status transitions, artifacts, billing facts, and invalid-input
rejection.
