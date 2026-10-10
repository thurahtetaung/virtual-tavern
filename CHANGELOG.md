# Changelog

## [0.8.0](https://github.com/thurahtetaung/virtual-tavern/compare/v0.7.0...v0.8.0) (2026-10-10)


### Features

* **admin:** download every word list as a zip backup ([#40](https://github.com/thurahtetaung/virtual-tavern/issues/40)) ([b958260](https://github.com/thurahtetaung/virtual-tavern/commit/b9582605e6ac74bf1c7ad3760f9400f552ed39b1))
* **echo:** add Echo, a cooperative one-word-clue game ([#38](https://github.com/thurahtetaung/virtual-tavern/issues/38)) ([bff623a](https://github.com/thurahtetaung/virtual-tavern/commit/bff623a2bad1e57b7c6c9ae96bd5be606d0edc76))
* **web:** mark the tab when it's your move ([#35](https://github.com/thurahtetaung/virtual-tavern/issues/35)) ([75e0c1a](https://github.com/thurahtetaung/virtual-tavern/commit/75e0c1aa2a07b2108167119405e7ca473ba96036))
* **word-lists:** let admins switch word lists on and off ([#39](https://github.com/thurahtetaung/virtual-tavern/issues/39)) ([ea16ecc](https://github.com/thurahtetaung/virtual-tavern/commit/ea16eccb2da8c92b87da4164f244a2af91bb3dd0))
* **word-lists:** let each word list choose which games offer it ([#34](https://github.com/thurahtetaung/virtual-tavern/issues/34)) ([f2f1ad9](https://github.com/thurahtetaung/virtual-tavern/commit/f2f1ad9e7440b7189cc4da9cc92a858c4a7204a9))

## [0.7.0](https://github.com/thurahtetaung/virtual-tavern/compare/v0.6.3...v0.7.0) (2026-10-10)


### Features

* **web:** add a light/dark theme switch and smooth out the room shell ([#33](https://github.com/thurahtetaung/virtual-tavern/issues/33)) ([c28af03](https://github.com/thurahtetaung/virtual-tavern/commit/c28af035e9540b0df8f04cb45bffbf04a1637fb6))


### Bug Fixes

* **server:** keep locked-out tabs, timers and host hand-off from getting stuck ([#31](https://github.com/thurahtetaung/virtual-tavern/issues/31)) ([8a4f6dd](https://github.com/thurahtetaung/virtual-tavern/commit/8a4f6ddf08a853b6af730498cce70aee4d0ece6f))

## [0.6.3](https://github.com/thurahtetaung/virtual-tavern/compare/v0.6.2...v0.6.3) (2026-10-10)


### Bug Fixes

* **server:** harden auth, error handling, health checks and the deploy script ([#29](https://github.com/thurahtetaung/virtual-tavern/issues/29)) ([bc54453](https://github.com/thurahtetaung/virtual-tavern/commit/bc54453737d6bba236202caa92469434796c0371))
* **ui:** make the game screens fit phones and desktops better ([#28](https://github.com/thurahtetaung/virtual-tavern/issues/28)) ([16d7f2b](https://github.com/thurahtetaung/virtual-tavern/commit/16d7f2b52b1166d354890a21cd1142d983f70c9e))

## [0.6.2](https://github.com/thurahtetaung/virtual-tavern/compare/v0.6.1...v0.6.2) (2026-10-10)


### Bug Fixes

* **codenames:** keep turns playable when a role leaves, lock teams mid-game and tighten clue rules ([#25](https://github.com/thurahtetaung/virtual-tavern/issues/25)) ([d9a943e](https://github.com/thurahtetaung/virtual-tavern/commit/d9a943e88e2167f261e8eafcef60e6dfb4a04d66))
* **enigma:** unstick alternating rounds, validate clues and lock teams after secrets are seen ([#24](https://github.com/thurahtetaung/virtual-tavern/issues/24)) ([77fa270](https://github.com/thurahtetaung/virtual-tavern/commit/77fa270bcd91a35c54e22fc40a6b653b3cc8dec1))
* **reverie:** stop turns stalling when players leave or stand up, and match the guide to the rules ([#23](https://github.com/thurahtetaung/virtual-tavern/issues/23)) ([cf2bd0a](https://github.com/thurahtetaung/virtual-tavern/commit/cf2bd0ad6e4146bf0b4be20d3323cf893716e10c))

## [0.6.1](https://github.com/thurahtetaung/virtual-tavern/compare/v0.6.0...v0.6.1) (2026-10-10)


### Bug Fixes

* stream private art through the server so browsers can keep it ([#21](https://github.com/thurahtetaung/virtual-tavern/issues/21)) ([4256b9c](https://github.com/thurahtetaung/virtual-tavern/commit/4256b9c07346ac1841364465fbd053762a92d908))

## [0.6.0](https://github.com/thurahtetaung/virtual-tavern/compare/v0.5.1...v0.6.0) (2026-10-10)


### Features

* add Reverie, the first back-room game, and retire the Peek demo ([#18](https://github.com/thurahtetaung/virtual-tavern/issues/18)) ([bbdf085](https://github.com/thurahtetaung/virtual-tavern/commit/bbdf0850a67018ae139d4e7d3cbe907d638633ed))

## [0.5.1](https://github.com/thurahtetaung/virtual-tavern/compare/v0.5.0...v0.5.1) (2026-10-10)


### Bug Fixes

* give the back room its own screen and list only games the server offers ([#15](https://github.com/thurahtetaung/virtual-tavern/issues/15)) ([599ca5b](https://github.com/thurahtetaung/virtual-tavern/commit/599ca5b7d2bae48ede068556bc2b02a0a033228e))

## [0.5.0](https://github.com/thurahtetaung/virtual-tavern/compare/v0.4.0...v0.5.0) (2026-10-10)


### Features

* add the back room for password-gated private games ([#13](https://github.com/thurahtetaung/virtual-tavern/issues/13)) ([946dfa8](https://github.com/thurahtetaung/virtual-tavern/commit/946dfa8790d8d169b596f91710da02b20822a682))

## [0.4.0](https://github.com/thurahtetaung/virtual-tavern/compare/v0.3.0...v0.4.0) (2026-10-10)


### Features

* add Enigma, a team code-breaking word game ([#11](https://github.com/thurahtetaung/virtual-tavern/issues/11)) ([6e282e8](https://github.com/thurahtetaung/virtual-tavern/commit/6e282e8992f22f317d486705ae9b20161a5165d7))

## [0.3.0](https://github.com/thurahtetaung/virtual-tavern/compare/v0.2.0...v0.3.0) (2026-10-10)


### Features

* built-in word packs and a word list picker ([#9](https://github.com/thurahtetaung/virtual-tavern/issues/9)) ([8c56efb](https://github.com/thurahtetaung/virtual-tavern/commit/8c56efbcb204bb59a7f6a245f7930663abadfc4f))

## [0.2.0](https://github.com/thurahtetaung/virtual-tavern/compare/v0.1.0...v0.2.0) (2026-10-10)


### Features

* **codenames:** clearer guessing, 1-9 clues, collapsible teams, soft timers ([#8](https://github.com/thurahtetaung/virtual-tavern/issues/8)) ([0e70859](https://github.com/thurahtetaung/virtual-tavern/commit/0e70859eb941a91556adee444d5402217972facf))


### Performance Improvements

* cache hashed assets for a year and revalidate HTML ([#6](https://github.com/thurahtetaung/virtual-tavern/issues/6)) ([3519592](https://github.com/thurahtetaung/virtual-tavern/commit/3519592c00df1dd9f82112683e3f601dc5ee1e47))

## 0.1.0 (2026-10-10)


### Features

* add Docker image, Cloudflare tunnel deploy, and automated releases ([46a2e62](https://github.com/thurahtetaung/virtual-tavern/commit/46a2e62f6364ae2f716c8178ab90eae40a016677))
* add game SDK and Codenames rules engine ([8059003](https://github.com/thurahtetaung/virtual-tavern/commit/8059003ed92f52b389de550378a6d706ba18f9ed))
* add room server with realtime play, persistence, word lists, and admin API ([c233041](https://github.com/thurahtetaung/virtual-tavern/commit/c233041b7cff54c3da3183a5965dbe73914bbd36))
* add web app with Codenames UI, rules guides, and admin word lists ([8a689fc](https://github.com/thurahtetaung/virtual-tavern/commit/8a689fcea09125ed1908169c9d79fd2cab91a5e6))
