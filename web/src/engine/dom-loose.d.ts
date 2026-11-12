// The app code came from plain JavaScript that reads things like event.target.closest(...) or element.value
// without saying what kind of element it is. These two lines let TypeScript accept that style, so the code
// could move over unchanged. New code should use the exact element types instead.
interface EventTarget { [key: string]: any }
interface Element { [key: string]: any }
