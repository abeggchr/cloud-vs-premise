import { AZURE_EMISSIONS_FACTORS_METRIC_TON_PER_KWH } from "@cloud-carbon-footprint/azure";
import { AZURE_CLOUD_CONSTANTS } from "@cloud-carbon-footprint/azure/src/domain";
import { AZURE_REGIONS } from "@cloud-carbon-footprint/azure/src/lib/AzureRegions";
import { INSTANCE_TYPE_COMPUTE_PROCESSOR_MAPPING } from "@cloud-carbon-footprint/azure/src/lib/VirtualMachineTypes";
import {
  CloudConstants,
  ComputeEstimator,
} from "@cloud-carbon-footprint/core";
import { ComputeUsageBuilder } from "@cloud-carbon-footprint/core/src/compute/ComputeUsage";
import { expect, test } from "vitest";

/**
 * Compares a cloud with an on-premise setup in terms of power consumption.
 * 
 * CAUTION: cloud and onPremise setups are not yet comparable.
 * The calculation is purely based on ASSUMPTIONS and WORK IN PROGESS. 
 */
test("cloud vs. on-premise", () => {
  
  /**
   * Calculates the power consumption in kWh for the following server:
   * - Supermicro high end enterprise server
   * - X11DPU motherboard
   * - 2x1000W redundant power supplies (96%)
   * - average power consumption (measured over 24h): 350W
   * - xxx cores / xxx threads (assume: cores*threads = 2592)
   * - xxx GB RAM
   * - running 1h
   */
  function onPremise() {
    return 0.35;
  }

  /**
   * The on-premise machine hosts 12 VMs with the following spec:
   * - Azure D8s v4
   * - 8 vCPU / 32 GB
   * - in Switzerland North
   * - 50% utilization
   * - running 1h
   */
  function cloud() {
    const computeProcessor = INSTANCE_TYPE_COMPUTE_PROCESSOR_MAPPING["D8s v3"];

    const constants: CloudConstants = {
      maxWatts: AZURE_CLOUD_CONSTANTS.getMinWatts(computeProcessor),
      minWatts: AZURE_CLOUD_CONSTANTS.getMaxWatts(computeProcessor),
      powerUsageEffectiveness: AZURE_CLOUD_CONSTANTS.getPUE(),
      replicationFactor: 12,
    };

    const builder = new ComputeUsageBuilder("now", constants);
    builder.addCpuUtilization(0.5); // 50% utilization
    builder.setVCpuHours(1); // running during 1h
    const data = builder.build();

    const computeEstimator = new ComputeEstimator();
    const estimation = computeEstimator.estimate(
      [data],
      AZURE_REGIONS.EU_SWITZERLAND.name,
      AZURE_EMISSIONS_FACTORS_METRIC_TON_PER_KWH,
      constants
    );

    if (estimation.length != 1) {
      throw Error("unexpected length");
    }

    // The "ConsumptionManagementService" also takes into account:
    // - storage (ssd, hdd)
    // - memory
    // - network
    // - unknown (?)
    // - embodied emissions
    // For this comparison, embodies emissions are out of scope.
    // The remaining estimates are included with the following factor: 
    const storageMemoryNetworkFactor = 1.5;

    return storageMemoryNetworkFactor * estimation[0].kilowattHours;
  }

  const cloud_kWh = cloud();
  const onPremise_kWh = onPremise();

  console.log(`Estimation: cloud ${cloud_kWh.toFixed(2)} vs. on-premise ${onPremise_kWh.toFixed(2)}`);

  expect(cloud_kWh).toBeLessThan(onPremise_kWh);
  expect(cloud_kWh).toBeGreaterThan(onPremise_kWh * 0.1);
});
