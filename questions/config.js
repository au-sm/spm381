/* This intentionally points at the SAME Apps Script backend already deployed
   for the SPM261 site (SPM261_26/questions/backend.gs) -- one shared Google
   Sheet holds every question from both courses, distinguished by the "Deck"
   column each submission is tagged with. No separate deployment needed.

   If you ever want SPM381 questions to land in a different Sheet, deploy a
   second copy of backend.gs (see that file's header for setup steps) and
   put its own .../exec URL here instead. */
window.QUESTIONS_API = "https://script.google.com/macros/s/AKfycbwbxzsuQ4q73aVSjPAAxEFaAkW4IAEXmR-YY7pgbSccmJ0WvrH5XFj4AYz39dPm1bS2/exec";
