export const GLASS = [
 {name:'Fragile Blue',score:10,color:0x079dff,density:0.7,crack:0.6,chip:1.0,fracture:1.6,roughness:.08,transmission:.72,thickness:.8,shards:20,pitch:1.5},
 {name:'Dense Emerald',score:25,color:0x06c66c,density:1.2,crack:1.1,chip:2.3,fracture:4.4,roughness:.14,transmission:.65,thickness:1,shards:17,pitch:1.1},
 {name:'Frosted Amber',score:50,color:0xff9808,density:1.6,crack:1.6,chip:3.3,fracture:6.2,roughness:.33,transmission:.38,thickness:1.2,shards:15,pitch:.75},
 {name:'Crystal Violet',score:100,color:0x8437ee,density:.9,crack:.7,chip:1.4,fracture:2.5,roughness:.05,transmission:.8,thickness:.7,shards:22,pitch:1.8},
 {name:'Reinforced Ruby',score:150,color:0xe60726,density:2.2,crack:2.3,chip:4.5,fracture:9,roughness:.19,transmission:.55,thickness:1.4,shards:14,pitch:.6}
];
export const TUNE={half:6,cube:.88,ballRadius:.38,ballDensity:7,gravity:18,returnAcceleration:2.4,launchMin:7,launchMax:24,catchWidth:1.9,railZ:4.8,comboWindow:2.1,maxFragments:240,maxDust:420,fragmentLife:3.2,step:1/90,maxSubsteps:6};
export const comboFor=n=>n>=8?3:n>=5?2:n>=3?1.5:1;
