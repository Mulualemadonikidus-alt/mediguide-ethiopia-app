import assert from "node:assert/strict";
import { normName, isDuplicate, extractJson, htmlToText, makePageLoader, processFacilities, processDoctors,
  verifyDoctor, personTokens, buildPrBody, buildIssueBody, pickRotating, cleanUrl, phoneTails } from "./lib.mjs";

// helpers
assert.equal(normName("Hayat Hospital & Medical College"), "hayat");
assert.ok(isDuplicate({ name: "Black Lion Hospital" }, [{ name: "Tikur Anbessa (Black Lion) Specialized Hospital" }]));
assert.ok(isDuplicate({ name: "Totally New", phone: "011 551 4141" }, [{ name: "Bethzatha General Hospital", phone: "+251 11 551 4141 / +251 11 551 9640" }]));
assert.ok(!isDuplicate({ name: "Zewditu Memorial Hospital", phone: "0111111111" }, [{ name: "Hayat Hospital", phone: "+251 11 157 5757" }]));
assert.deepEqual(extractJson('Here you go:\n```json\n[{"a":1}]\n```'), [{ a: 1 }]);
assert.equal(extractJson("no json"), null);
assert.deepEqual(phoneTails("+251 11 551 4141 / 0115519640"), ["115514141", "115519640"]);
assert.equal(cleanUrl("javascript:alert(1)"), "");
assert.equal(cleanUrl("https://evil.com/x", /(^|\.)facebook\.com$/), "");
assert.ok(cleanUrl("https://www.facebook.com/abc", /(^|\.)facebook\.com$/));
assert.deepEqual(personTokens("Dr. Fasil Tekle (Interventional)"), ["fasil", "tekle"]);

// fake web
const pages = {
  "https://real-hospital.example/about": htmlToText("<html><body><h1>Zewditu Memorial Hospital</h1><p>Tel +251 11 123 4567. Dr. Abebe Kebede, nephrologist, joined our dialysis unit.</p><script>x</script></body></html>"),
  "https://other.example/list": htmlToText("<p>Hayat Hospital cardiology: Dr. Meron Tadesse</p>"),
};
const load = makePageLoader(async (u) => pages[u] || "");

const base = [{ id: 13, name: "Hayat Hospital & Medical College", phone: "+251 11 157 5757" }];
const model = [
  { name: "Zewditu Memorial Hospital", type: "public", address: "Addis Ababa", phone: "+251 11 123 4567", website: "https://real-hospital.example/about",
    description: "Public hospital.", tags: ["nephrology", "bogus-tag", "dialysis"],
    specialties: [{ name: "Nephrology", subspecialties: ["Dialysis"], doctors: ["Dr. Abebe Kebede", "Dr. Invented Person"] }], sources: ["https://real-hospital.example/about"] },
  { name: "Imaginary Wellness Plaza", type: "private", phone: "+251 11 999 0000", sources: ["https://fake.example/none"] },   // hallucinated
  { name: "Hayat Hospital", phone: "" },                                                                                  // duplicate
  { name: "Wrong Phone Hospital Zewditu", type: "private", phone: "+251 11 000 1111", sources: ["https://real-hospital.example/about"] },
];
const f = await processFacilities({ candidates: model, groundUrls: [], load, existing: base, startId: 100, date: "2026-11-16" });
assert.equal(f.accepted.length, 1, JSON.stringify(f.rejected));
const h = f.accepted[0].hospital;
assert.equal(h.id, 100); assert.equal(h.type, "Public"); assert.deepEqual(h.tags, ["nephrology", "dialysis"]);
assert.equal(h.phone, "+251 11 123 4567"); assert.equal(h.appt, "Call +251 11 123 4567");
assert.deepEqual(h.specs[0].docs, ["Dr. Abebe Kebede"]);              // invented doctor dropped
assert.deepEqual(f.accepted[0].flags.droppedDoctors, ["Dr. Invented Person"]);
assert.ok(f.rejected.find((r) => r.name === "Imaginary Wellness Plaza"));
assert.ok(f.rejected.find((r) => r.reason === "already listed"));
// 4th candidate shares the hospital page name tokens? "wrong phone hospital zewditu" -> tokens wrong,phone,zewditu: 'wrong' missing -> rejected
assert.ok(f.rejected.find((r) => r.name.startsWith("Wrong Phone")));

// doctors
const docs = await processDoctors({
  items: [
    { hospital: "Hayat Hospital", specialty: "Cardiology", doctor: "Dr. Meron Tadesse", sources: ["https://other.example/list"] },
    { hospital: "Hayat Hospital", specialty: "Cardiology", doctor: "Dr. Ghost Doctor", sources: ["https://other.example/list"] },
    { hospital: "Nonexistent Clinic", doctor: "Dr. A B" },
    { hospital: "Hayat Hospital", doctor: "Dr. Belay Abebe", specialty: "Neurosurgery" },
  ],
  load, hospitals: base, docsByHospital: new Map([[13, "Dr. Belay Abebe (Neurosurgery) | Dr. Yonas Tesfaye"]]), date: "2026-11-16",
});
assert.equal(docs.accepted.length, 1); assert.equal(docs.accepted[0].name, "Dr. Meron Tadesse"); assert.equal(docs.accepted[0].hospitalId, 13);
assert.equal(docs.rejected.length, 3);

// rotation + reports
assert.equal(pickRotating([1, 2, 3, 4], 2, 0).join(), "1,2"); assert.equal(pickRotating([1, 2, 3, 4], 2, 1).join(), "3,4");
const pr = buildPrBody({ date: "2026-11-16", facilities: f.accepted, doctors: docs.accepted, rejectedFacilities: f.rejected, rejectedDoctors: docs.rejected, focuses: ["a", "b"] });
assert.match(pr, /Zewditu Memorial Hospital/); assert.match(pr, /Imaginary Wellness Plaza/); assert.match(pr, /Merge\*\* to publish/);
assert.match(buildIssueBody({ date: "d", spot: [{ name: "X", phone: "1" }], hasPr: true }), /pull request/);
console.log("ALL LIB TESTS PASSED");
