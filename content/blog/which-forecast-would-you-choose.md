+++
title = "Which Forecast Would You Choose?"
date = 2026-09-19

[taxonomies]
categories = ["Data Science"]
+++

Which forecast would you choose for the next 28 days?

The grey line shows daily sales of one food item at a Walmart store in Wisconsin. The blue and orange lines show two forecasts. Pick one before you reveal the actual sales.

<!-- more -->

![Recent daily sales followed by two forecasts for April 25 through May 22, 2016. Forecast A stays closer to the recent sales level, while Forecast B projects lower sales.](/img/quiver-m5-forecast-before.png)

*The shaded area marks the forecast window. The item–store series is `FOODS_3_150_WI_2` from the public [M5 Forecasting Accuracy dataset](https://www.kaggle.com/competitions/m5-forecasting-accuracy/data).*

Forecast A came from a LightGBM model trained with squared error. Forecast B came from a Poisson regression. Both were fitted on sales from before the forecast window. Once the window began, each model used its own predictions to forecast subsequent days.

{% detail(title="Reveal the actual sales", default_open=false) %}
![The same forecasts with actual daily sales overlaid in black. Forecast A is above actual sales every day, and Forecast B is closer on average.](/img/quiver-m5-forecast-after.png)

During the next 28 days, Forecast A was above actual sales every day. Forecast B was closer to the lower sales level, though it missed several peaks. Its mean absolute error was **5.37 units per day**, compared with **12.98** for Forecast A.

Forecast A can look convincing because its sharp peaks and dips resemble the recent sales history. Forecast B looks smoother and sits well below much of that history. In this window, actual sales still spiked, but they fluctuated around a lower level. Forecast A captured the familiar spikiness while consistently forecasting too high.
{% end %}

I ran this example on public Walmart data to illustrate a blind comparison I used while evaluating monthly demand forecasts. I describe that workflow in [Forecasting Sparse Demand at Quiver](/projects/quiver-internship/).
