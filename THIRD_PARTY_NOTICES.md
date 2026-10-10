# Third-party notices

Locust includes work from the projects below, under their licences.

## Optional local voice typing

The Windows microphone's first-use Download retrieves whisper.cpp build b5454
and Whisper tiny.en Q5_1 weights. Neither the executable nor the model ships in
the installer. Their MIT notices are kept alongside the downloaded files in
`voice/LICENSE.txt`; the exact notice is in `apps/desktop/src/shared/voice-license.ts`.

- whisper.cpp / ggml: MIT, Copyright (c) 2023-2026 The ggml authors.
  https://github.com/ggml-org/whisper.cpp/blob/b5454/LICENSE
- Whisper model: MIT, Copyright (c) 2022 OpenAI.
  https://github.com/openai/whisper/blob/main/LICENSE

## PDF.js

- Project: https://github.com/mozilla/pdf.js
- Licence: Apache License, Version 2.0, Copyright Mozilla Foundation.
  https://www.apache.org/licenses/LICENSE-2.0
- Version: `pdfjs-dist` 6.3.289, unmodified.
- What Locust uses: the library, bundled into the page that opens an
  attached PDF for an agent (`apps/desktop/src/renderer/pdf.html`,
  `apps/desktop/src/renderer/src/pdfReader.ts`). It reads the PDF's text and
  draws its pages as pictures on this machine; nothing is fetched.

## OpenPets

- Project: https://github.com/OpenPetsHQ/openpets
- Licence: MIT, Copyright (c) 2026 OpenPets
- Commit: `2d14120cf027c9e80db7ff78e60711be08d39df4`
- What Locust uses:
  - The Hoodie Cat sprite sheet (`apps/desktop/assets/default-pet-spritesheet.webp`),
    shipped as `apps/desktop/resources/pets/hoodie-cat/spritesheet.webp`, with
    the licence beside it (`LICENSE` in the same folder).
  - The pet format and its rules, ported to TypeScript in
    `apps/desktop/src/shared/pets.ts` and `apps/desktop/src/main/pet-library.ts`:
    the sheet layouts, rows and timings (`codex-pets-core.ts`,
    `reaction-animation-mapping.ts`) and the catalog's address rules
    (`catalog-validation.ts`).

Pets in the openpets.dev gallery are not part of Locust. A person who adds one
downloads it from openpets.dev to their own computer; its rights stay with its
maker, as the gallery's terms say. Locust ships none of them.

```
MIT License

Copyright (c) 2026 OpenPets

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
