# Seedance New API Bridge

A New API Task Plugin that exposes the official Doubao/Seedance task API on the client-facing gateway and forwards it to an upstream New API gateway.

```text
Client official Seedance API -> this bridge -> upstream New API Doubao plugin -> Seedance
```

Install `plugins/tasks/seedance-bridge/1.0.0/plugin.js` from the marketplace index. The upstream channel must point to the New API server that has the official Doubao/Seedance plugin enabled.

See [HANDOVER.md](HANDOVER.md) for setup, routing, model mapping, billing and validation details.
