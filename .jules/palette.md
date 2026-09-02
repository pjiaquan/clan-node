## 2024-05-20 - Adding loading states for async actions

**Learning:** This application inconsistently implements loading indicators on critical form submissions (authentication, setup, invite acceptance, and modal submissions). While some buttons (like in `EditPersonModal`) disable appropriately and show inline spinners, the majority of forms lack visual feedback during submission. This results in users experiencing uncertainty after form submission and could lead to multiple clicks, as well as breaking accessibility expectations for async feedback.

**Action:** Consistently adopt the `.btn-inline-spinner` alongside disabling buttons during `submitting` states across all `btn-primary` submit buttons.
## 2023-08-07 - Missing Accessibility Attributes on Dropdown Menus
**Learning:** Dropdown menus built with custom HTML elements (buttons and divs) frequently omit `aria-expanded` and `aria-haspopup` attributes, significantly impairing the experience for screen reader users who cannot determine the menu's state or purpose.
**Action:** When implementing or reviewing custom dropdown menus or interactive toggle components, always ensure that `aria-expanded` and `aria-haspopup` are correctly paired on the trigger element to properly announce the interaction model to assistive technologies.

## 2024-05-20 - Ensure loading states for generic modals
**Learning:** We implemented a loading state in `AddPersonModal`. I've observed that some modals like `AddPersonModal` don't disable their 'Cancel' buttons or display proper feedback with inline spinners during async submissions. This leaves the interface unresponsive during a network call or creation flow, breaking expectations for async actions in similar components.
**Action:** When adding async submission functions in forms and modals, always apply the `btn-inline-spinner` class, set standard `disabled={submitting}` states on inputs/buttons, and provide clear user feedback during submission (e.g., text changing from 'Submit' to 'Saving...').

## 2024-09-02 - Modal Keyboard Accessibility
**Learning:** This application relies heavily on modal dialogs for critical user workflows (Add Person, Create User, Report Issue, etc.), but lacked consistent keyboard dismissal via the 'Escape' key, violating standard a11y expectations and causing friction for keyboard-only users.
**Action:** When creating new modals in the future, always include a `useEffect` hook that listens for `keydown` and calls `onClose()` if the key is 'Escape', ensuring proper cleanup in the return function.
