# Paper Reed — selected patterns

The user has accepted the current interface as the first-version baseline, including account identity direction B and the label color treatment. Real-data workflows and accessibility still need validation; architecture and implementation stack remain undecided. Current specs: `design/INTERFACE.md`. Proposed mail behavior: `design/MAIL-CORE.md`.

- Paper-white surface, ink text, reed-green actions; quiet thin rules rather than elevated cards.
- System sans-serif UI; Iowan Old Style brand. Existing 4px spacing rhythm and 20px list text line-height remain.
- Sender avatar: 32px circle; 1.5px account-colored ring; 3px inner padding; neutral monogram center, 11px type. No external avatar service chosen.
- Avatar occupies a dedicated grid column: centered on the 44px text block, with 12px text gap (8px in narrowest layout). Keep 68px horizontal / 88px stacked rows.
- Sender, subject and date align on their first line in horizontal layout. In stacked layout the avatar centers on sender + subject; summary aligns with text.
- Checkbox center follows avatar center. Unread remains separate: stronger text + date-side dot. Selection remains reed wash.
- A single-account view keeps the avatar but neutralizes the account ring. Account names/addresses remain explicit in menus and message metadata.
- Preserve account color customization. Shape customizations belong to metadata/menu markers, not the round avatar.

- Label identity is independent of account identity. Sidebar uses the configured color as a small swatch; mail chips mix 20% label color into paper for the background and 25% label color into ink for text. Keep subject, sender, selection and avatar ring unchanged.
