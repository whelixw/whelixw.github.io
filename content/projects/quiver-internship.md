+++
title = "Forecasting Sparse Demand at Quiver"
date = 2026-09-19
aliases = ["/blog/quiver-internship/"]
template = "post.html"

[taxonomies]
categories = ["Work", "Data Science"]
+++

From March to June 2026, I worked as a Data Science Intern at Quiver, developing and evaluating monthly product-level demand forecasts for inventory planning. Many products sold irregularly, with long gaps between sales or occasional spikes. A forecast could react too strongly to one spike, carry a short-lived trend too far, or stay at zero for too long.

<!-- more -->

## Building a reproducible comparison

I built a Python experimentation framework to compare candidate models with Quiver’s production exponential smoothing (ETS) baseline. Each experiment saved the configuration it ran with, the predictions, and aggregate error metrics. This let me compare approaches across customers, validation periods, and data filters, then return to an individual forecast when a result needed investigation.

I tested gradient-boosting models with lagged demand, rolling statistics, and seasonal features. I also explored DeepAR, product hierarchies, routing logic for sparse series, and regression strategies based on product size.

## Finding where models disagreed

Aggregate scores could tell me how a model performed across a set of products. To understand where it struggled, I looked at two properties of each series. Average demand interval (ADI) describes how often positive demand occurs. The squared coefficient of variation (CV²) describes how much demand varies across the periods when it is positive. Together, these measures distinguish smooth, erratic, intermittent, and lumpy series.

At Quiver, I measured ADI in months. The chart below illustrates the same method using 365 days of public Walmart sales, so ADI is measured in days. Each point represents one item at one store.

![Demand-pattern scatter for 281 M5 item–store series. The highlighted item falls in the smooth segment, with an ADI of 1.02 days and a CV² of 0.34.](/img/quiver-m5-demand-patterns.png)

*The highlighted item sold on nearly every day in the period, placing it in the smooth segment at daily frequency.*

In Quiver’s internal series inspector, I could select a point on a demand map and open the corresponding product’s sales history and forecasts. That made it easier to see which products drove a difference in scores and examine what each model was doing on those series.

## Comparing forecasts in context

I also designed an internal dashboard for blind comparisons. We first judged which forecast looked more plausible given the history, then revealed observed demand and compared our judgments with mean absolute error, root mean squared error, and bias. You can try the same format in [Which Forecast Would You Choose?](/blog/which-forecast-would-you-choose/).

When a candidate passed the quantitative evaluation, we loaded its forecasts into the planning frontend alongside the production forecast. We reviewed individual products there and looked for behaviour such as an outsized response to a single spike or the continuation of a trend that had already faded.

## From forecast scores to inventory decisions

Forecast error matters through the replenishment decisions it informs. Repeatedly forecasting too low can leave a customer exposed to stockouts. Forecasting too high can tie up cash in inventory. The consequences depend on the product and how the planner uses the forecast. More complex models can also require more tuning, monitoring, and maintenance.

Looking closely at model disagreements helped me identify products that might benefit from different treatment and cases where a simpler approach deserved further trials. I presented my findings to Quiver’s CEO and CTO, and the work helped inform further trials of a simpler, customer-tuned model.
