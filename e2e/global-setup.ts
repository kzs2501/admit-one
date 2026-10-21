/** Before the browser tests: the camera feed the door scanner's camera test plays. */
import { signDemoTicket } from "../src/core/demo-ticket-key";
import { CAMERA_FEED, CAMERA_TICKET, writeCameraFeed } from "./door";

export default function globalSetup() {
  writeCameraFeed(CAMERA_FEED, signDemoTicket(CAMERA_TICKET));
}
