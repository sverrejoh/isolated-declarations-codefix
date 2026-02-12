import { REMOTE_HUB, REMOTE_PORT } from "./constants.ts";

const HUB = "hub";
const TEAMS = "teams";
const NUM_VAL = 42;

export enum Hosts {
  Hub = HUB,
  Teams = TEAMS,
  RemoteHub = REMOTE_HUB,
}

export enum Numbers {
  Answer = NUM_VAL,
  RemotePort = REMOTE_PORT,
}
