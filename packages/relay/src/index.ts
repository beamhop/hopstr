// @nostragent/relay — one resilient connection to one relay.
export {
  Relay,
  buildAuthTemplate,
  type RelayOptions,
  type SubscribeHandlers,
  type PublishResult,
  type ConnectionState,
  type WebSocketLike,
  type WebSocketFactory,
} from './relay.ts'

export {
  parseRelayMessage,
  serializeClientMessage,
  reasonPrefix,
  type ClientMessage,
  type RelayMessage,
  type ReasonPrefix,
} from './messages.ts'

export {
  fetchRelayInformation,
  infoUrl,
  supportsNip,
  clampLimit,
  type RelayInformation,
} from './nip11.ts'
