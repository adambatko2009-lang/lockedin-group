import Boot from "@/components/Boot";

// The page skeleton from the old index.html. The engine fills #app, #rail, #topbar and #tabbar,
// and opens the panel, picture viewer, report form and tutorial when needed.
const X = (
  <svg className="sym" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export default function Home() {
  return (
    <>
      <div id="splash" aria-hidden="true"><img src="icons/icon-192.png" alt="" /><span>LockedIn</span></div>
      <main>
        <nav className="rail" id="rail" aria-label="Main" hidden></nav>
        <div className="topbar glass" id="topbar" hidden></div>
        <div id="app"><div className="card"><p className="msg">Loading…</p></div></div>
      </main>
      <nav className="tabbar glass" id="tabbar" aria-label="Pages" hidden></nav>
      <input type="file" id="shotinput" accept="image/*" multiple hidden />
      <input type="file" id="logoinput" accept="image/*" hidden />
      <div className="toast glass" id="toast" role="status" aria-live="polite" hidden></div>
      <div className="scrim" id="scrim" hidden></div>
      <div className="ptr glass" id="ptr" aria-live="polite" hidden></div>
      <div className="tour" id="tour" hidden>
        <div className="tour-hole" id="tour-hole"></div>
        <div className="tour-card" id="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title">
          <div className="tour-top"><span className="tour-n" id="tour-n"></span><button className="round tour-x" id="tour-skip" aria-label="Skip tutorial" title="Skip tutorial">{X}</button></div>
          <h3 id="tour-title"></h3><p id="tour-text"></p>
          <div className="tour-dots" id="tour-dots" aria-hidden="true"></div>
          <div className="tour-actions"><button className="btn plain small" id="tour-back">Back</button><button className="btn primary small" id="tour-next">Next</button></div>
        </div>
      </div>
      <div className="panel" id="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title" hidden></div>
      <dialog id="viewer" aria-label="Picture">
        <div className="vtop"><div className="vcap" id="viewer-cap"></div><span className="vn" id="viewer-n"></span><button className="round" id="viewer-close" aria-label="Close">{X}</button></div>
        <div className="vstage" id="viewer-stage"><img id="viewer-img" alt="" draggable="false" /></div>
        <button className="vnav prev" id="viewer-prev" aria-label="Previous picture"><svg className="ic" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg></button>
        <button className="vnav next" id="viewer-next" aria-label="Next picture"><svg className="ic" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9.5 6 6 6-6 6" /></svg></button>
        <div className="vbar"><span className="vhint" id="viewer-hint"></span><button className="btn plain small vreport" id="viewer-report">Report</button><button className="btn danger small" id="viewer-delete">Delete</button></div>
      </dialog>
      <dialog id="reportdlg" aria-labelledby="report-title">
        <form method="dialog" className="repform" id="report-form">
          <h2 id="report-title">Report this</h2>
          <p className="sub-hint" id="report-what"></p>
          <fieldset className="repreasons"><legend>What&apos;s wrong with it?</legend>
            <label><input type="radio" name="rep-reason" value="inappropriate" /><span>Inappropriate or explicit</span></label>
            <label><input type="radio" name="rep-reason" value="harassment" /><span>Harassment or hate</span></label>
            <label><input type="radio" name="rep-reason" value="spam" /><span>Spam</span></label>
            <label><input type="radio" name="rep-reason" value="other" /><span>Something else</span></label>
          </fieldset>
          <label className="flabel" htmlFor="report-detail">More details <span style={{ textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
          <textarea className="field" id="report-detail" maxLength={300} rows={3}></textarea>
          <p className="sub-hint">Only the group owner and the app owner see reports. The person you report isn&apos;t told who sent it.</p>
          <p className="sub-hint" id="report-msg" role="status" aria-live="polite"></p>
          <div className="repbtns"><button type="button" className="btn plain small" id="report-cancel">Cancel</button>
            <button type="button" className="btn primary small" id="report-send">Send report</button></div>
        </form>
      </dialog>
      <Boot />
    </>
  );
}
