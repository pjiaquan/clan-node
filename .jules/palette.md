## 2024-05-20 - Adding Escape Key Support to Modals
**Learning:** It is crucial to implement keyboard accessibility (specifically the Escape key to close) for all custom modals to adhere to accessibility standards.
**Action:** Always implement a `keydown` event listener for 'Escape' in the `useEffect` hook of modal components to trigger the `onClose` function.

