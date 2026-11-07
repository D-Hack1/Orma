import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({ region: "asia-south1", maxInstances: 10 });

export { setSharing } from "./platform/sharing";
export { saveProfile, createFamily, addFamilyMember, inviteFamilyMember, joinFamily, listMyFamilies, getFamily, updateMedicineSchedule, registerDevice } from './platform/family';
export { logDose, askStatus, answer, explain } from './api';
export { understand } from './ai';
export { parsePrescription, confirmPrescription, checkStrip, checkPillbox } from './vision';
export { voice, sms } from './telephony';
export { recordingCleanup } from './telephony/cleanup';
export { doseSweep, retryCall } from './scheduler';
export { escalate, ackAlert, alertCreated } from './alerts';
export { sendMessage } from './messages';
export { snooze, explainMedicine } from './doses/support';
export { dailyDigest, dailyDigestScheduled } from './summaries';
export { doctorReport } from './reports';
export { downloadMedia } from './platform/media';
export { flSubmit, flAggregate } from './fl';
