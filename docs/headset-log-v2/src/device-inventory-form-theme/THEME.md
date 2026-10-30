# Headset log form: theme

Private. Google Forms has no script setting for theme colours in anything I read, so these are set by hand in the form
editor, under Customize theme. `Code.gs` builds the questions only.

| Setting | Value | Why |
|---|---|---|
| Header image | `form-header-1600x400.png` | A strand of pearls. 1600 x 400 is the size third-party guides recommend; Forms crops to 4:1 |
| Theme colour | Oyster `#6E6A5F` (custom colour) | Used on the Submit button and selected answers; about 5:1 against white text |
| Background | Ivory `#FBF9F1` (custom colour) | |
| Header font | Spectral, or the nearest light serif offered | |
| Question and text font | Hanken Grotesk, or the nearest clean sans offered | |

Whether Spectral and Hanken Grotesk are offered is not verified: Google's help says only that you can change font and
size. Palette: Ivory `#FBF9F1`, Pearl `#F1EEE6`, Nacre `#DAD5C9`, Oyster `#6E6A5F`, Ink `#33322E`.

Forms draws white question cards and its own section bars, which cannot be restyled. `form-preview.html` and
`form-preview.png` approximate the result with sample data; the PNG was rendered without the web fonts, so it shows a
fallback serif. The real form's look is checked in the pilot.

The form's own progress bar is switched on by the script (`setProgressBar(true)`); test T14 in the pilot plan checks that it shows.
