import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const messages = [
  // Short
  "Liming...",
  "Reasoning...",
  "Macoing...",
  "Hustling by the market...",
  "Heading to the bus park...",
  "Catching a minibus...",
  "Holding a lil vibes...",
  "Cooling out...",
  "Passing through Stabroek...",
  "Swinging by Bourda...",
  "Walking the seawall...",
  "Stopping by the rum shop...",
  "Buying two beers...",
  "Getting some cutters...",
  "Whining pun a ting...",
  "Don't seh 40...",
  "Frying plantain...",
  "Stirring cook-up rice...",
  "Warming pepperpot...",
  "Peeling cassava...",
  "Cutting lime for the drinks...",
  "Filling the igloo cooler...",
  "Looking for a red mango...",
  "Checking on the pot...",
  "Making a market run...",
  "Catching the last car...",
  "Listening for the kiskadees...",
  "Watching the rain clouds...",
  "Waiting till breeze come...",
  "Sharing a small piece...",
  "Saving a plate for later...",
  "Holding strain...",
  "Moving just now...",

  // Long
  "Heading to the bus park and hoping the minibus full up quick...",
  "Liming by Stabroek and talking bare nonsense...",
  "Stopping by the rum shop and buying two cold beers...",
  "Getting some cutters because the drinks cyan go down so plain...",
  "Whining pun a ting like the speaker hit the right tune...",
  "Trying hard not to seh 40 and still nearly letting it slip...",
  "Making a quick market run before the rain start fall...",
  "Walking the seawall and catching a proper evening breeze...",
  "Checking if the pot done before everybody start asking for food...",
  "Saving a lil cook-up rice because somebody always coming over...",
  "Warming pepperpot like it tasting even better the next day...",
  "Passing through Bourda and trying not to buy more than planned...",
  "Waiting on the bus and watching everybody else hustle through...",
  "Cooling out under the gallery till the heat ease up...",
  "Cutting lime and setting up drinks for the whole set...",
  "Listening to old stories that start with 'leh me tell yuh'...",
  "Holding a corner by the shop and catching up on everything missed...",
  "Trying to leave the lime but one more story keep starting...",
  "Watching the road flood a lil and still planning how to get through...",
  "Packing up snacks like the trip gon' take all day...",
  "Looking for the best plantain and pretending it is a quick stop...",
  "Waiting till everybody ready, which means waiting plenty longer...",
  "Moving just now, but first taking one last small sit-down...",
];

function pickRandom(): string {
  return messages[Math.floor(Math.random() * messages.length)];
}

export default function (pi: ExtensionAPI) {
  pi.on("turn_start", async (_event, ctx) => {
    ctx.ui.setWorkingMessage(pickRandom());
  });

  pi.on("turn_end", async (_event, ctx) => {
    ctx.ui.setWorkingMessage(); // Reset for next time
  });
}
