# Fate companion animation assets

14 unique Servants and seven selected Masters from Fate/stay night and Fate/Zero, each with an `anime` (original-series-inspired) and a `chibi` (cute companion) appearance. The 21 chibi choices are enabled by default in the independent character picker. Anime variants are archived and can be enabled live through the character library or avatar API. Saber and Gilgamesh, shared between both stories, appear once per style. Hundred Faces uses a representative masked Assassin appearance.

The PNG source sheets were generated with the built-in image_gen tool, then mechanically fitted to equal playback cells and losslessly encoded as WebP. They are newly generated fan artwork, not official production frames or a claim of pixel-identical reproduction. Character designs remain associated with TYPE-MOON and the Fate rights holders. No redistribution approval is inferred from generation or attribution.

`./sources.json` records every full prompt, file hash and frame layout. Character/identity references: [Fate/stay night](https://www.fate-sn.com/) and [Fate/Zero official character page](https://www.fate-zero.jp/characters/).

Each full strip contains eight 384 × 416 transparent cells. Frame pairs: 0–1 attentive/blink; 2–3 laptop work; 4–5 greeting; 6–7 rest. Each preview strip contains the same eight cells at 192 × 208. `scripts/build-pet-previews.mjs` regenerates previews from the shipped full strips.

`FatePet` selects the pair using the employee's actual work/communication state and hover. The picker uses compact portraits and one full-size animated selection preview. Static Message portraits and live animation share a square cover frame, with no extra transparent padding. Playback respects canvas pause and reduced motion. Existing avatars and employee records are not replaced.

Selected Masters: Shirou Emiya, Rin Tohsaka, Sakura Matou, Illyasviel von Einzbern, Kiritsugu Emiya, Kirei Kotomine and Waver Velvet. They use the same flat picker and animation player as the Servants. Character reference: [official Heaven's Feel character page](https://www.fatestaynightusa.com/story-chara/?page=chara).
