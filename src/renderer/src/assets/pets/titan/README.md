# Attack on Titan chibi portraits

19 principal characters: Eren, Mikasa, Armin, Levi, Erwin, Hange, Jean, Sasha,
Connie, Historia, Reiner, Annie, Bertholdt, Ymir, Zeke, Pieck, Porco, Gabi and Falco.

Each transparent portrait was generated individually with the built-in `image_gen`
tool, mechanically resized and losslessly encoded as WebP. `sources.json` records
every full prompt and the shipped file hash. These are generated fan illustrations,
not official production artwork. Generation does not grant rights in the underlying
characters; redistribution review remains pending.

`TitanPet` uses transform-only breathing, attention and greeting motion, selected by
the existing employee activity and visibility gates. Offscreen and hidden inbox
portraits do not run animation players. Reduced-motion uses the same static artwork.
There is no additional avatar frame. Static crops are built by
`scripts/build-avatar-portraits.mjs` and share their framing with live portraits.

Select through `avatar.list --query Eren --style chibi` / `card.avatar`, or the
existing character library. The user profile uses `messenger.profile`; selecting a
portrait changes appearance only and never the message author or employee identity.
