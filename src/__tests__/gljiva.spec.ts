import { providers } from "@0xsequence/multicall";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import sinon from "sinon";
import { ItemType, OrderType } from "../constants";
import { TestERC1155 } from "../typechain";
import { CreateOrderInput, OrderWithCounter } from "../types";
import * as fulfill from "../utils/fulfill";
import { describeWithFixture } from "./utils/setup";

describeWithFixture(
  "As a user I want to buy now or accept an offer partially",
  (fixture) => {
    let offerer: SignerWithAddress;
    let zone: SignerWithAddress;
    let fulfiller: SignerWithAddress;
    let multicallProvider: providers.MulticallProvider;

    let fulfillStandardOrderSpy: sinon.SinonSpy;
    let standardCreateOrderInput: CreateOrderInput;
    let secondTestErc1155: TestERC1155;

    const nftId = "1";

    const OPENSEA_DOMAIN = "opensea.io";
    const OPENSEA_TAG = "360c6ebe";

    beforeEach(async () => {
      [offerer, zone, fulfiller] = await ethers.getSigners();
      multicallProvider = new providers.MulticallProvider(ethers.provider);

      fulfillStandardOrderSpy = sinon.spy(fulfill, "fulfillStandardOrder");

      const TestERC1155 = await ethers.getContractFactory("TestERC1155");
      secondTestErc1155 = await TestERC1155.deploy();
      await secondTestErc1155.deployed();
    });

    afterEach(() => {
      fulfillStandardOrderSpy.restore();
    });

    describe("An ERC1155 is partially transferred", async () => {
      describe("[Buy now] I want to partially buy an ERC1155", async () => {
        it("ERC1155 <=> ETH (gljiva)", async () => {
          /**
           * mint 3 NFTs for 800 quantity
           * list 100 of each per 0.01, 0.001, 0.0001
           * buy 1 of each
           * buy 1 of each
           * buy 4, 5, 6 - here the problem happens
           * buy 1 of each - this is not working anymore
           */

          async function logOrderStatus(order: OrderWithCounter) {
            const orderStatus = await seaport.getOrderStatus(
              seaport.getOrderHash(order.parameters)
            );

            console.log("order", orderStatus);
          }

          async function createOrder(
            tokenId: string,
            amount: string,
            singlePrice: string
          ) {
            // create first order
            standardCreateOrderInput = {
              allowPartialFills: true,

              offer: [
                {
                  itemType: ItemType.ERC1155,
                  token: testErc1155.address,
                  amount,
                  identifier: tokenId,
                },
              ],
              consideration: [
                {
                  amount: parseEther(singlePrice).mul(amount).toString(),
                  recipient: offerer.address,
                },
              ],
              // 2.5% fee
              fees: [{ recipient: zone.address, basisPoints: 250 }],
            };

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

            await logOrderStatus(order);

            return order;
          }

          async function fulfillOrder(
            orderDetails: { order: OrderWithCounter; unitsToFill: number }[]
          ) {
            const { actions: actions1 } = await seaport.fulfillOrders({
              fulfillOrderDetails: orderDetails,
              accountAddress: fulfiller.address,
              domain: OPENSEA_DOMAIN,
            });

            expect(actions1.length).to.eq(1);

            const action1 = actions1[0];

            expect(action1).to.deep.equal({
              type: "exchange",
              transactionMethods: action1.transactionMethods,
            });

            const transaction1 = await action1.transactionMethods.transact();

            await transaction1.wait();

            expect(transaction1.data.slice(-8)).to.eq(OPENSEA_TAG);
          }

          async function assertBalances(
            tokenId: string,
            offerer: string,
            offererBalance: number,
            fulfiller: string,
            fulfillerBalance: number
          ) {
            const offererErc1155Balance1 = await testErc1155.balanceOf(
              offerer,
              tokenId
            );

            const fulfillerErc1155Balance1 = await testErc1155.balanceOf(
              fulfiller,
              tokenId
            );

            expect(offererErc1155Balance1).eq(BigNumber.from(offererBalance));
            expect(fulfillerErc1155Balance1).eq(
              BigNumber.from(fulfillerBalance)
            );
          }

          const { seaport, testErc1155 } = fixture;

          await testErc1155.mint(offerer.address, "0", 800);
          await testErc1155.mint(offerer.address, "1", 800);
          await testErc1155.mint(offerer.address, "2", 800);

          const order1 = await createOrder("0", "100", "0.01");
          const order2 = await createOrder("1", "100", "0.001");
          const order3 = await createOrder("2", "100", "0.0001");

          await fulfillOrder([
            {
              order: order1,
              unitsToFill: 1,
            },
            {
              order: order2,
              unitsToFill: 1,
            },
            {
              order: order3,
              unitsToFill: 1,
            },
          ]);

          console.log("bought one of each");
          await logOrderStatus(order1);
          await logOrderStatus(order2);
          await logOrderStatus(order3);

          await assertBalances("0", offerer.address, 799, fulfiller.address, 1);
          await assertBalances("1", offerer.address, 799, fulfiller.address, 1);
          await assertBalances("2", offerer.address, 799, fulfiller.address, 1);

          await fulfillOrder([
            {
              order: order1,
              unitsToFill: 1,
            },
            {
              order: order2,
              unitsToFill: 1,
            },
            {
              order: order3,
              unitsToFill: 1,
            },
          ]);

          console.log("bought one of each");
          await logOrderStatus(order1);
          await logOrderStatus(order2);
          await logOrderStatus(order3);

          await assertBalances("0", offerer.address, 798, fulfiller.address, 2);
          await assertBalances("1", offerer.address, 798, fulfiller.address, 2);
          await assertBalances("2", offerer.address, 798, fulfiller.address, 2);

          await fulfillOrder([
            {
              order: order1,
              unitsToFill: 4,
            },
            {
              order: order2,
              unitsToFill: 5,
            },
            {
              order: order3,
              unitsToFill: 6,
            },
          ]);

          console.log("bought 4, 5, 6");
          await logOrderStatus(order1);
          await logOrderStatus(order2);
          await logOrderStatus(order3);

          await assertBalances("0", offerer.address, 794, fulfiller.address, 6);
          await assertBalances("1", offerer.address, 793, fulfiller.address, 7);
          await assertBalances("2", offerer.address, 792, fulfiller.address, 8);

          await fulfillOrder([
            {
              order: order1,
              unitsToFill: 1,
            },
            {
              order: order2,
              unitsToFill: 1,
            },
            {
              order: order3,
              unitsToFill: 1,
            },
          ]);

          console.log("bought one of each");
          await logOrderStatus(order1);
          await logOrderStatus(order2);
          await logOrderStatus(order3);

          await assertBalances("0", offerer.address, 793, fulfiller.address, 7);
          await assertBalances("1", offerer.address, 792, fulfiller.address, 8);
          await assertBalances("2", offerer.address, 791, fulfiller.address, 9);
        });
      });
    });
  }
);
