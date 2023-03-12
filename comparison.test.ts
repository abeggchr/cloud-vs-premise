import { AZURE_EMISSIONS_FACTORS_METRIC_TON_PER_KWH } from "@cloud-carbon-footprint/azure";
import { AZURE_CLOUD_CONSTANTS } from "@cloud-carbon-footprint/azure/src/domain";
import { AZURE_REGIONS } from "@cloud-carbon-footprint/azure/src/lib/AzureRegions";
import { INSTANCE_TYPE_COMPUTE_PROCESSOR_MAPPING } from "@cloud-carbon-footprint/azure/src/lib/VirtualMachineTypes";
import { VIRTUAL_MACHINE_TYPE_SERIES_MAPPING } from "@cloud-carbon-footprint/azure/src/lib/VirtualMachineTypes";
import {
  CloudConstants,
  ComputeEstimator,
  EmbodiedEmissionsEstimator,
  EmbodiedEmissionsUsage,
  MemoryEstimator,
  NetworkingEstimator,
  StorageEstimator,
} from "@cloud-carbon-footprint/core";
import { ComputeUsageBuilder } from "@cloud-carbon-footprint/core/src/compute/ComputeUsage";
import { test } from "vitest";

/**
 * Estimate the emissions using the cloud carbon footprint tool for 12 VMs with the following spec:
 * - Azure D8s v4
 * - 8 vCPU / 32 GB
 * - in Switzerland North
 * - 50% utilization
 * - 256GB SSD storage
 * - running 1h
 * - causing 1gb Azure-internal traffic per hour
 */
test("cloud compute example", () => {
  const computeProcessor = INSTANCE_TYPE_COMPUTE_PROCESSOR_MAPPING["D8s v3"];
  const virtualMachine = VIRTUAL_MACHINE_TYPE_SERIES_MAPPING["D2s-64s v3"]["D8s v3"];
  const largestInstanceVirtualMachine = VIRTUAL_MACHINE_TYPE_SERIES_MAPPING["D2s-64s v3"]["D64s v3"];
  const hours = 1; // NOTE: running 1h

  const VIRTUAL_MACHINE_INDEX = {
    VCPU: 0,
    MEMORY: 1,
    EMBODIED_EMISSIONS: 2,
  };

  const constants: CloudConstants = {
    maxWatts: AZURE_CLOUD_CONSTANTS.getMaxWatts(computeProcessor),
    minWatts: AZURE_CLOUD_CONSTANTS.getMinWatts(computeProcessor),
    powerUsageEffectiveness: AZURE_CLOUD_CONSTANTS.getPUE(),
    replicationFactor: 12,
  };

  const estimates = {
    compute: {},
    ssdStorage: {},
    network: {},
    memory: {},
    embodiedEmission: {},
  };

  // compute
  const computeUsageBuilder = new ComputeUsageBuilder("now", constants);
  computeUsageBuilder.addCpuUtilization(50); // 50% utilization
  computeUsageBuilder.setVCpuHours(
    hours * virtualMachine[VIRTUAL_MACHINE_INDEX.VCPU] // QUESTION: correct?
  );
  const computeEstimator = new ComputeEstimator();
  const computeEstimation = computeEstimator.estimate(
    [computeUsageBuilder.build()],
    AZURE_REGIONS.EU_SWITZERLAND.name,
    AZURE_EMISSIONS_FACTORS_METRIC_TON_PER_KWH,
    constants
  );
  estimates.compute = computeEstimation[0];

  // ssdStorage
  const ssdStorageUsage = {
    terabyteHours: hours * 0.256, // NOTE: 256GB SSD storage
  };
  const ssdStorageEstimator = new StorageEstimator(
    AZURE_CLOUD_CONSTANTS.SSDCOEFFICIENT!
  );
  const ssdStorageEstimation = ssdStorageEstimator.estimate(
    [ssdStorageUsage],
    AZURE_REGIONS.EU_SWITZERLAND.name,
    AZURE_EMISSIONS_FACTORS_METRIC_TON_PER_KWH,
    constants
  );
  estimates.ssdStorage = ssdStorageEstimation[0];

  // hddStorage = 0

  // network
  const networkEstimator = new NetworkingEstimator(
    AZURE_CLOUD_CONSTANTS.NETWORKING_COEFFICIENT!
  );
  const networkEstimation = networkEstimator.estimate(
    [
      {
        gigabytes: 1 * hours, // NOTE: 1gb Azure-internal traffic per hour
      },
    ],
    AZURE_REGIONS.EU_SWITZERLAND.name,
    AZURE_EMISSIONS_FACTORS_METRIC_TON_PER_KWH,
    constants
  );
  estimates.network = networkEstimation[0];

  // memory
  const memoryEstimator = new MemoryEstimator(
    AZURE_CLOUD_CONSTANTS.MEMORY_COEFFICIENT!
  );
  const memoryEstimate = memoryEstimator.estimate(
    [
      {
        gigabyteHours:
          virtualMachine[VIRTUAL_MACHINE_INDEX.MEMORY] * hours,
      },
    ],
    AZURE_REGIONS.EU_SWITZERLAND.name,
    AZURE_EMISSIONS_FACTORS_METRIC_TON_PER_KWH,
    constants
  );
  estimates.memory = memoryEstimate[0];

  // embodied emissions
  const embodiedEmissionsUsage: EmbodiedEmissionsUsage = {
    usageTimePeriod: hours,
    instancevCpu: virtualMachine[VIRTUAL_MACHINE_INDEX.VCPU],
    largestInstancevCpu:
      largestInstanceVirtualMachine[VIRTUAL_MACHINE_INDEX.VCPU],
    scopeThreeEmissions:
      virtualMachine[VIRTUAL_MACHINE_INDEX.EMBODIED_EMISSIONS]
      * constants.replicationFactor!, 
      // QUESTION: is it correct, that the replication factor has to be set here explicitly (while in other estimator it is picked up from the constants)?
  };
  console.log(embodiedEmissionsUsage);
  const embodiedEmissionsEstimator = new EmbodiedEmissionsEstimator(
    AZURE_CLOUD_CONSTANTS.SERVER_EXPECTED_LIFESPAN! // NOTE: is in hours, same as usageTimePeriod
  );
  const embodiedEmissionsEstimation = embodiedEmissionsEstimator.estimate(
    [embodiedEmissionsUsage],
    AZURE_REGIONS.EU_SWITZERLAND.name,
    AZURE_EMISSIONS_FACTORS_METRIC_TON_PER_KWH
    /*
    {
      // QUESTION: the lower the emission factor is, the higher the embodied emission in kWh are.
      // The emission factor is roughly 10x lower for Azure Switzerland than for Switzerlands grid.
      // Shouldn't the regular grids emission factor be used here? Or even better the manufacturing countries emissions?
      switzerland: AZURE_EMISSIONS_FACTORS_METRIC_TON_PER_KWH[AZURE_REGIONS.EU_SWITZERLAND.name] * 10,
    }
    */
  );
  estimates.embodiedEmission = embodiedEmissionsEstimation[0];
  console.log(JSON.stringify(estimates.embodiedEmission));

  // unknown estimator
  // QUESTION: what is this estimator for? is it correct to asume that this is less relevant than storage and network?

  // console output for kWh
  let kwhTable = {};
  let kwhTotal = 0;
  for (const property in estimates) {
    kwhTotal += estimates[property].kilowattHours;
  }
  for (const property in estimates) {
    kwhTable[property] = {
      kWh: estimates[property].kilowattHours.toFixed(3),
      percentage:
        ((estimates[property].kilowattHours / kwhTotal) * 100).toFixed() + "%",
    };
  }
  console.table(kwhTable);

  // console output for gC02eq
  let co2eqTable = {};
  let co2eqTotal = 0;
  for (const property in estimates) {
    co2eqTotal += estimates[property].co2e;
  }
  for (const property in estimates) {
    co2eqTable[property] = {
      ["CO2eq [g]"]: (estimates[property].co2e * 1000000).toFixed(2), // NOTE: display in gramms
      percentage:
        ((estimates[property].co2e / co2eqTotal) * 100).toFixed() + "%",
    };
  }
  console.table(co2eqTable);
});
