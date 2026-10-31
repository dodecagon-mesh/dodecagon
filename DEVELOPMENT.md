# Development

## Requirements

- [Bun](https://bun.sh/)
- [Tmux](https://github.com/tmux/tmux) (optional)

## Setup

1. Clone the repository.
2. Run `bun install`.
3. Start the app:
   - With tmux: `./start.sh`
   - Without tmux: run `bun dev` in both `apps/client` and `apps/server`

Development data is stored in `apps/server/data`, including the database and uploaded files.
Delete that folder if you want a clean reset.

## Environment variables

A deployment reads its settings from `config.ini` in the data directory, and
every setting can be overridden by an environment variable.

| Variable | What it changes |
| --- | --- |
| `DODECAGON_DATA_PATH` | directory that holds the database, the uploaded files and `config.ini` |
| `DODECAGON_HOST` | interface the server binds to |
| `DODECAGON_PORT` | port the server listens on, `4991` by default |
| `DODECAGON_DEBUG` | verbose logging |
| `DODECAGON_AUTOUPDATE` | automatic server updates |
| `DODECAGON_BACKUP_DATABASE` | nightly database backups |
| `DODECAGON_MAX_REQUEST_BODY_BYTES` | size limit for uploads |
| `DODECAGON_ALLOWED_ORIGINS` | origins allowed to call the API |
| `DODECAGON_TRUSTED_PROXIES` | proxies whose forwarded headers are trusted |
| `DODECAGON_WEBRTC_PORT` | UDP port of the media server, `40000` by default |
| `DODECAGON_WEBRTC_ANNOUNCED_ADDRESS` | address the media server announces |
| `DODECAGON_WEBRTC_MAX_BITRATE` | bitrate ceiling for streams |
| `DODECAGON_WEBRTC_TURN_URLS` | TURN relays for restrictive networks |
| `DODECAGON_WEBRTC_TURN_SECRET` | shared secret of those relays |
| `DODECAGON_WEBRTC_TURN_TTL` | lifetime of the issued TURN credentials |
| `DODECAGON_OIDC_ENABLED` | turns the OpenID Connect login on |
| `DODECAGON_OIDC_ISSUER` | issuer of the identity provider |
| `DODECAGON_OIDC_CLIENT_ID` | client id at the identity provider |
| `DODECAGON_OIDC_CLIENT_SECRET` | client secret at the identity provider |
| `DODECAGON_OIDC_REDIRECT_URI` | callback the provider sends the user back to |
| `DODECAGON_OIDC_DISABLE_LOCAL_LOGIN` | closes the password login |

The data directory defaults to `~/.config/dodecagon` on Linux,
`~/Library/Application Support/dodecagon` on macOS, `%APPDATA%\dodecagon` on
Windows, and `/home/bun/.config/dodecagon` inside the container image. A data
directory written by an earlier release keeps its old name, so point
`DODECAGON_DATA_PATH` at it or move it to the new one.

## Mock data

To start from a server that looks used rather than empty, stop the dev server and run:

```bash
cd apps/server
bun run seed:mock
```

It **wipes `apps/server/data`** and rebuilds it: users, roles, categories, text and voice
channels, a private channel, messages spread over weeks with replies, threads, reactions and
pins, plus a few direct messages. Log in as `admin` with `password123`; every mock user shares
that password, and `useToken("dev")` still claims ownership.

It also creates a `#counting` channel holding 10,000 messages numbered `0` to `9999`, oldest
first, so scrolling, pagination and jump-to-message can be checked against a message that says
exactly where you are. Authors and timestamps alternate between runs of the same person seconds
apart, which the client draws as one group, and switches or longer gaps, which it draws
separately.

`--size small|medium|large` changes the volume (large is 25k messages, for pagination and
search), `--seed <number>` changes the cast, and `--counting <n>` resizes the numbered channel
(`0` skips it). The same seed always produces the same server.

## Native peer-to-peer media

Updated desktop clients use Holepunch for microphone audio, webcams, screen
video, and captured screen audio by default. The native bridge carries the
existing WebRTC media packets over HyperDHT's encrypted unordered messages;
capture, audio processing, and codecs stay in WebRTC. Browser clients and older
desktop clients without the native media bridge use mediasoup.

Routing is per sender, recipient, and media kind, including group calls. A
browser joining or one failed peer does not move healthy native pairs onto the
relay. Full peer-to-peer fan-out increases the sender's upload with the number
of recipients.

`webRtc.holepunchMediaEnabled` defaults to `true`. To disable native peer-to-peer
media server-wide, set it to `false` in `config.ini` or start `apps/server` with:

```bash
DODECAGON_WEBRTC_HOLEPUNCH_MEDIA_ENABLED=false bun dev
```

The old server-side `directScreenSharing` option and
`DODECAGON_WEBRTC_DIRECT_SCREEN_SHARING` variable no longer control this path.
The existing saved client direct-media preference is preserved; a saved off
preference opts that desktop client out. Direct peers can learn each other's
network address.

Mediasoup transports and producer metadata remain available for discovery and
fallback. Publishers pause their relay RTP while no relay consumer needs it,
without disabling the shared capture track. Browsers and blocked or failed
native paths cause the necessary relay publishers to resume. If relay-demand
signalling fails, publishers stay relay-enabled rather than leaving listeners
silent. A failed pair does not repeatedly retry during the same publication.

Screen viewing remains opt-in with **View demo**. **Stop viewing** closes that
viewer's incoming direct session and pauses its relayed screen video and audio,
without ending the presenter's capture or preventing a later direct rewatch.
Unwatched offers expire within the negotiation deadline. Native microphone
attempts have a five-second client deadline; camera and screen attempts have an
eight-second deadline, including signalling and native setup. Failure reuses
the captured tracks through mediasoup without requesting capture again.

Holepunch performs native peer discovery and hole punching, rather than using
the browser direct-media STUN/TURN path. Existing SFU ICE and TURN configuration
continues to apply to mediasoup connections.

### Network status

**User Settings > Network status** answers the question a failed direct
connection always raises: does this network allow one? The check gathers server
reflexive candidates from the STUN list the server publishes
(`webRtc.directScreenStunUrls`, exposed to clients as `webRtcStunUrls`) and
compares the public port every server reports for the same local socket. One
stable port means an endpoint independent mapping, so peers can reach this
device directly. A different port per destination means a symmetric mapping,
where direct media cannot be established and everything falls back to the
server relay. A server that publishes fewer than two STUN entries is topped up
with public ones, and the page says so.

The result is written to the renderer log as a `[VOICE] network status` line
with the mapped addresses, so a user can hand over the file instead of
reproducing a call. The same verdict is reported to the deployment's own
Sentry-compatible tracker as `network.reachability`, with the counts and the
server hosts but never the mapped address.

## Voice-only mode

Enable **Voice-only mode** in **User Settings > Devices** to send and receive
microphone audio only. The preference is saved on this device, defaults to off,
and can be changed during a call. Saving it stops this user's webcam and screen
sharing, including captured screen audio, and closes incoming camera, screen,
and external-media consumers on both the client and server. Direct screen
connections are closed too; microphone connections and mute/deafen settings
remain unchanged, including mode changes during initial voice connection setup.

Turning the mode off resumes available remote media, including only previously
viewed demos, without restarting this user's camera or screen sharing. Camera
and screen controls are disabled while the saved mode is enabled. No database
migration is required.

## Focused call controls

Call controls, captions and edge scrims appear together while the pointer is
over the stage, a control has keyboard focus, or a menu is open. Leaving the
stage starts a 150 ms opacity fade immediately, without an idle timer or
transition delay; hidden controls stop accepting pointer input immediately.
Reduced-motion mode disables this fade. Touch controls remain available after
a tap and dismiss on the next tap outside the stage.

A focused screen share keeps its aspect ratio and reserves space above the
thumbnail row while controls are visible. Hiding the controls releases that
space. The presenter's stream indicator does not mount a second media player.

Voice card menus keep the media subtree mounted even when no actions are
available. Picture-in-picture support resolves after the video mounts; changing
the wrapper at that point replaces the player and loses its `srcObject`.
Disable the menu without replacing the player.

## Testing

To run tests, use the following command:

```bash
bun run test
```

(if you only run `bun test` it's gonna fail, you NEED to run `bun run test`)

For the full local gate (format, lint, typecheck, tests, build and the four E2E shards),
run `bun run signoff`. It needs an authenticated `gh` CLI and the `basecamp/gh-signoff`
extension; see [AGENTS.md](AGENTS.md) for the one-time setup and the pushed-branch
requirement.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.
