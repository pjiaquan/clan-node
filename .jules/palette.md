## 2024-05-20 - Adding loading states for async actions

**Learning:** This application inconsistently implements loading indicators on critical form submissions (authentication, setup, invite acceptance, and modal submissions). While some buttons (like in `EditPersonModal`) disable appropriately and show inline spinners, the majority of forms lack visual feedback during submission. This results in users experiencing uncertainty after form submission and could lead to multiple clicks, as well as breaking accessibility expectations for async feedback.

**Action:** Consistently adopt the `.btn-inline-spinner` alongside disabling buttons during `submitting` states across all `btn-primary` submit buttons.
## 2023-08-07 - Missing Accessibility Attributes on Dropdown Menus
**Learning:** Dropdown menus built with custom HTML elements (buttons and divs) frequently omit `aria-expanded` and `aria-haspopup` attributes, significantly impairing the experience for screen reader users who cannot determine the menu's state or purpose.
**Action:** When implementing or reviewing custom dropdown menus or interactive toggle components, always ensure that `aria-expanded` and `aria-haspopup` are correctly paired on the trigger element to properly announce the interaction model to assistive technologies.
